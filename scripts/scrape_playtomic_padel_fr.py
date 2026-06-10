#!/usr/bin/env python3
"""
scrape_playtomic_padel_fr.py — enrichissement padel FR depuis Playtomic (#345).

Playtomic expose une API publique interrogeable en HTTP simple (spike #345 — PAS
de Bright Data) :
  - Discovery : GET api.playtomic.io/v1/tenants?sport_id=PADEL&coordinate=lat,lon
               &radius=<m>&size=<n>  → liste de clubs (tenant_id, nom, adresse).
  - Détail    : GET api.playtomic.io/v1/tenants/{id}  → resources[] (courts
               indoor/outdoor), properties.WEBSITE_URL / CONTACT_PHONE, slug/url.

Ce script découvre les clubs Playtomic sur une grille FR, les apparie à nos
venues padel (géo < seuil + Jaro-Winkler nom), et écrit un RAPPORT de
correspondances (JSON) à spot-checker.

Deux modes :
  - DRY-RUN (défaut, PR B) : aucune écriture DB. Sert à valider le matching.
  - --apply (PR C) : pour chaque club matché, upsert idempotent dans
    `external_ref` (clé source='playtomic', external_id=tenant_id) + PATCH du
    venue (booking_url / courts_indoor / courts_outdoor). Les colonnes/table
    proviennent de la migration 0048 (#345 PR A) — qui doit être pushée en prod
    AVANT le premier --apply, sinon PostgREST renvoie 42703/404.

Usage :
    python3 scripts/scrape_playtomic_padel_fr.py --self-test
    python3 scripts/scrape_playtomic_padel_fr.py --limit 30 --out /tmp/padel.json
    python3 scripts/scrape_playtomic_padel_fr.py            # grille FR, dry-run
    python3 scripts/scrape_playtomic_padel_fr.py --apply    # écrit en DB

Stdlib only (urllib, json, math) — comme osm/overture_import.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent

API = "https://api.playtomic.io/v1/tenants"
UA = "SportHub/1.0 (+https://sporthubmap.com; padel enrichment)"

# Matching à 2 paliers (#345 — calibré sur le dry-run run #27139515137, où le
# seuil unique 100 m / JW 0.85 ne matchait que 4 % et laissait 1 faux positif) :
#   - nom FORT (JW ≥ NAME_STRONG) : tolère un écart géo jusqu'à GEO_FAR_M — les
#     coords OSM/Overture vs Playtomic divergent souvent de 100-250 m pour le
#     même club (géocodages différents).
#   - nom FAIBLE (JW ≥ NAME_WEAK)  : exige la proximité (≤ GEO_NEAR_M) — garde-fou
#     contre les noms génériques ("Tennis Club …") qui gonflent le JW.
# Ajustables après revue du rapport de dry-run.
GEO_NEAR_M = 120.0
GEO_FAR_M = 300.0
NAME_STRONG = 0.92
NAME_WEAK = 0.88

# Grille de découverte couvrant la France métropolitaine (bbox). Le dédup par
# tenant_id élimine les doublons entre cellules voisines.
#
# IMPORTANT (#345, mesuré 2026-06) : l'endpoint Playtomic /v1/tenants ne pagine
# PAS et plafonne le nombre de clubs renvoyés par requête bien sous `size`
# (Paris 40 km → 28, Lyon → 8). Le seul levier pour augmenter la couverture est
# donc de DENSIFIER la grille : plus de points d'écoute rapprochés → l'union des
# « N plus proches » de chaque point capte beaucoup plus de clubs. Pas 0.5°
# (~55 km, 125 clubs FR) → 0.25° (~20 km). Rayon 25 km > demi-diagonale de la
# cellule (~17 km) → aucun trou entre cellules.
FR_BBOX = (41.3, -5.1, 51.1, 9.6)  # (S, W, N, E)
GRID_STEP_DEG = 0.25
SEARCH_RADIUS_M = 25_000


# ── Géo + similarité (pur, testé) ──────────────────────────────────────────────
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance en mètres entre deux points (formule de haversine)."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _norm(s: str) -> str:
    """Normalise un nom pour comparaison : minuscules, sans accents simples,
    espaces compactés."""
    s = (s or "").lower().strip()
    repl = (("é", "e"), ("è", "e"), ("ê", "e"), ("à", "a"), ("â", "a"),
            ("î", "i"), ("ï", "i"), ("ô", "o"), ("û", "u"), ("ù", "u"),
            ("ç", "c"), ("-", " "), ("'", " "), ("’", " "))
    for a, b in repl:
        s = s.replace(a, b)
    return " ".join(s.split())


def jaro(s1: str, s2: str) -> float:
    """Similarité de Jaro (0..1)."""
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    match_dist = max(len(s1), len(s2)) // 2 - 1
    s1_m = [False] * len(s1)
    s2_m = [False] * len(s2)
    matches = 0
    for i, c in enumerate(s1):
        lo = max(0, i - match_dist)
        hi = min(i + match_dist + 1, len(s2))
        for j in range(lo, hi):
            if not s2_m[j] and s2[j] == c:
                s1_m[i] = s2_m[j] = True
                matches += 1
                break
    if matches == 0:
        return 0.0
    t = 0
    k = 0
    for i in range(len(s1)):
        if s1_m[i]:
            while not s2_m[k]:
                k += 1
            if s1[i] != s2[k]:
                t += 1
            k += 1
    t /= 2
    return (matches / len(s1) + matches / len(s2) + (matches - t) / matches) / 3


def jaro_winkler(a: str, b: str, p: float = 0.1) -> float:
    """Jaro-Winkler sur noms normalisés (bonus préfixe commun, max 4)."""
    s1, s2 = _norm(a), _norm(b)
    j = jaro(s1, s2)
    prefix = 0
    for c1, c2 in zip(s1, s2):
        if c1 == c2 and prefix < 4:
            prefix += 1
        else:
            break
    return j + prefix * p * (1 - j)


def parse_padel_courts(resources: list[dict[str, Any]]) -> tuple[int, int]:
    """(indoor, outdoor) — nombre de courts PADEL actifs par type."""
    indoor = outdoor = 0
    for r in resources or []:
        if r.get("sport_id") != "PADEL" or not r.get("is_active", True):
            continue
        rtype = ((r.get("properties") or {}).get("resource_type") or "").lower()
        if rtype == "indoor":
            indoor += 1
        elif rtype == "outdoor":
            outdoor += 1
        else:
            outdoor += 1  # type inconnu → compté comme outdoor (défaut prudent)
    return indoor, outdoor


def playtomic_booking_url(detail: dict) -> str | None:
    """Page de réservation publique Playtomic du club (pure, testable).

    On N'UTILISE PAS `detail['url']` : pour beaucoup de clubs il pointe vers
    l'API backend de leur logiciel de résa (ex. `https://api.syltek.com`),
    inexploitable pour un utilisateur. La page club Playtomic
    `https://playtomic.io/tenant/<tenant_id>` redirige vers l'interface de résa.
    """
    tid = detail.get("tenant_id")
    return f"https://playtomic.io/tenant/{tid}" if tid else None


# ── HTTP Playtomic ─────────────────────────────────────────────────────────────
def _get(url: str) -> Any:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def search_tenants(lat: float, lon: float, radius: int, size: int = 100) -> list[dict]:
    q = urllib.parse.urlencode({
        "sport_id": "PADEL",
        "coordinate": f"{lat},{lon}",
        "radius": radius,
        "size": size,
    })
    try:
        data = _get(f"{API}?{q}")
        return data if isinstance(data, list) else []
    except Exception as e:  # noqa: BLE001
        print(f"    ⚠ search {lat:.2f},{lon:.2f}: {e}", file=sys.stderr)
        return []


def is_fr_club(t: dict) -> bool:
    """Vrai si le club Playtomic est en France (address.country_code == 'FR').
    La recherche par rayon (40 km) déborde des frontières → Playtomic renvoie
    des clubs ES/BE/DE/IT/CH près des bords de la bbox. On ne garde que la FR
    (sinon on enrichirait nos venues avec des clubs étrangers, et un --limit
    se remplit de clubs espagnols dans le coin SO avant d'atteindre la France)."""
    return ((t.get("address") or {}).get("country_code") or "").upper() == "FR"


def tenant_detail(tenant_id: str) -> dict | None:
    try:
        return _get(f"{API}/{urllib.parse.quote(tenant_id)}")
    except Exception as e:  # noqa: BLE001
        print(f"    ⚠ detail {tenant_id}: {e}", file=sys.stderr)
        return None


def fr_grid() -> list[tuple[float, float]]:
    s, w, n, e = FR_BBOX
    pts = []
    lat = s
    while lat <= n:
        lon = w
        while lon <= e:
            pts.append((round(lat, 3), round(lon, 3)))
            lon += GRID_STEP_DEG
        lat += GRID_STEP_DEG
    return pts


# ── Nos venues padel (lecture seule) ───────────────────────────────────────────
def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    f = _REPO_ROOT / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = env.get("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL", "")
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY")
           or env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
           or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not url or not key:
        print("❌ SUPABASE_URL / clé manquants (.env.local)", file=sys.stderr)
        raise SystemExit(1)
    return url, key


def _rest_get(url: str, key: str, path: str) -> list[dict]:
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data if isinstance(data, list) else []


def load_padel_venues_fr(url: str, key: str) -> list[dict]:
    """Charge les venues padel FR (id, name, lat, lon) via PostgREST, en DEUX
    requêtes simples et indexées (évite le scan de `venue` 267k+ qui timeout en
    500, cf. run #27138981141) :

      1. venue_ids padel via `venue_sport` filtré sur sport_slug='padel'
         (index sélectif), en keyset sur venue_id.
      2. détails venue par lots d'ids (PK index) + filtres résiduels FR/publié.

    Pas de jointure latérale `venue!inner` → coût borné par le nombre de venues
    padel, pas par la taille de `venue`.
    """
    # 1) tous les venue_id padel (monde), keyset sur venue_id.
    vids: list[str] = []
    last = ""
    while True:
        path = "venue_sport?select=venue_id&sport_slug=eq.padel&order=venue_id.asc&limit=2000"
        if last:
            path += f"&venue_id=gt.{last}"
        rows = _rest_get(url, key, path)
        if not rows:
            break
        vids.extend(r["venue_id"] for r in rows)
        last = rows[-1]["venue_id"]
        if len(rows) < 2000:
            break

    # 2) détails par lots d'ids ; filtres FR/publié appliqués côté serveur.
    venues: list[dict] = []
    for chunk in _chunks(vids, 200):
        ids = ",".join(urllib.parse.quote(str(i)) for i in chunk)
        path = (
            f"venue?select=id,name,lat,lon&id=in.({ids})"
            f"&country_code=eq.FR&is_published=eq.true&deleted_at=is.null"
        )
        venues.extend(_rest_get(url, key, path))
    return venues


def is_match(score: float, dist_m: float) -> bool:
    """Règle d'acceptation à 2 paliers (pure, testée)."""
    return (
        (score >= NAME_STRONG and dist_m <= GEO_FAR_M)
        or (score >= NAME_WEAK and dist_m <= GEO_NEAR_M)
    )


def best_match(club: dict, venues: list[dict]) -> dict | None:
    """Meilleur venue pour un club Playtomic selon la règle is_match. Priorité
    au meilleur Jaro-Winkler, puis à la plus petite distance."""
    addr = club.get("address") or {}
    coord = addr.get("coordinate") or {}
    clat, clon = coord.get("lat"), coord.get("lon")
    if clat is None or clon is None:
        return None
    cname = club.get("tenant_name") or ""
    best = None
    for v in venues:
        d = haversine_m(clat, clon, v["lat"], v["lon"])
        if d > GEO_FAR_M:
            continue
        score = jaro_winkler(cname, v.get("name") or "")
        if not is_match(score, d):
            continue
        if (best is None or score > best["score"]
                or (score == best["score"] and d < best["distance_m"])):
            best = {"venue_id": v["id"], "venue_name": v.get("name"),
                    "distance_m": round(d, 1), "score": round(score, 3)}
    return best


# ── Apply : construction des écritures (pur, testable) ─────────────────────────
def build_external_ref_rows(report: list[dict], now_iso: str) -> list[dict]:
    """Lignes `external_ref` pour les clubs matchés (upsert sur (source,
    external_id)). Garde le payload brut utile + la fraîcheur (last_seen_at)."""
    rows: list[dict] = []
    for r in report:
        m = r.get("match")
        if not m or not r.get("playtomic_id"):
            continue
        rows.append({
            "venue_id": m["venue_id"],
            "source": "playtomic",
            "external_id": r["playtomic_id"],
            "payload_json": {
                "playtomic_name": r.get("playtomic_name"),
                "courts_indoor": r.get("courts_indoor"),
                "courts_outdoor": r.get("courts_outdoor"),
                "booking_url": r.get("booking_url"),
                "website_url": r.get("website_url"),
                "match_distance_m": m.get("distance_m"),
                "match_score": m.get("score"),
            },
            "last_seen_at": now_iso,
        })
    return rows


def build_venue_patches(report: list[dict]) -> list[tuple[str, dict]]:
    """(venue_id, patch) d'enrichissement par venue matché. Si plusieurs clubs
    Playtomic visent le même venue, on garde le meilleur score (un venue = un
    club résa). `courts_*` = 0 est une info valide → écrite ; booking_url
    seulement si non vide."""
    best_by_venue: dict[str, tuple[dict, float]] = {}
    for r in report:
        m = r.get("match")
        if not m:
            continue
        vid = m["venue_id"]
        score = m.get("score") or 0.0
        prev = best_by_venue.get(vid)
        if prev is None or score > prev[1]:
            best_by_venue[vid] = (r, score)
    patches: list[tuple[str, dict]] = []
    for vid, (r, _score) in best_by_venue.items():
        patch: dict[str, Any] = {}
        if r.get("booking_url"):
            patch["booking_url"] = r["booking_url"]
        if r.get("courts_indoor") is not None:
            patch["courts_indoor"] = r["courts_indoor"]
        if r.get("courts_outdoor") is not None:
            patch["courts_outdoor"] = r["courts_outdoor"]
        if patch:
            patches.append((vid, patch))
    return patches


def build_booking_link_rows(report: list[dict]) -> list[dict]:
    """Lignes `booking_link` (partner='playtomic', sport='padel') pour les venues
    matchés — c'est CE QUE LA FICHE AFFICHE (composant VenueBookingLinks, via
    /api/go), pas la colonne venue.booking_url. Upsert sur la clé unique
    (venue_id, partner, sport_slug). Dédup par venue (meilleur score)."""
    best_by_venue: dict[str, tuple[dict, float]] = {}
    for r in report:
        m = r.get("match")
        if not m or not r.get("booking_url"):
            continue
        vid = m["venue_id"]
        score = m.get("score") or 0.0
        prev = best_by_venue.get(vid)
        if prev is None or score > prev[1]:
            best_by_venue[vid] = (r, score)
    return [
        {
            "venue_id": vid,
            "partner": "playtomic",
            "url": r["booking_url"],
            "sport_slug": "padel",
            "is_active": True,
        }
        for vid, (r, _s) in best_by_venue.items()
    ]


def _chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def _write(url: str, key: str, path: str, body: Any, method: str, prefer: str) -> None:
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=60):
        pass  # 204 No Content attendu (Prefer: return=minimal)


def apply_enrichment(
    url: str, key: str, report: list[dict], now_iso: str
) -> tuple[int, int, int]:
    """Écrit les enrichissements en DB. Retourne (refs, venues_patchés, booking_links).
    Idempotent : ré-exécutable sans doublon.
      - external_ref : traçabilité (source, external_id).
      - venue : colonnes booking_url / courts_* (data brute).
      - booking_link : CE QUE LA FICHE AFFICHE (partner=playtomic, sport=padel),
        upsert sur (venue_id, partner, sport_slug)."""
    refs = build_external_ref_rows(report, now_iso)
    patches = build_venue_patches(report)
    links = build_booking_link_rows(report)
    for chunk in _chunks(refs, 100):
        _write(
            url, key, "external_ref?on_conflict=source,external_id", chunk,
            method="POST", prefer="return=minimal,resolution=merge-duplicates",
        )
    for vid, patch in patches:
        _write(
            url, key, f"venue?id=eq.{urllib.parse.quote(str(vid))}", patch,
            method="PATCH", prefer="return=minimal",
        )
    for chunk in _chunks(links, 100):
        _write(
            url, key, "booking_link?on_conflict=venue_id,partner,sport_slug", chunk,
            method="POST", prefer="return=minimal,resolution=merge-duplicates",
        )
    return len(refs), len(patches), len(links)


# ── Pipeline ───────────────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> int:
    url, key = load_env()
    print("▶ chargement des venues padel FR…")
    venues = load_padel_venues_fr(url, key)
    print(f"  ✓ {len(venues):,} venues padel FR")

    print("▶ découverte Playtomic (grille FR)…")
    seen: dict[str, dict] = {}
    for i, (lat, lon) in enumerate(fr_grid()):
        for t in search_tenants(lat, lon, SEARCH_RADIUS_M):
            tid = t.get("tenant_id")
            if tid and tid not in seen and is_fr_club(t):
                seen[tid] = t
        if args.limit and len(seen) >= args.limit:
            break
        time.sleep(0.15)  # politesse
    tenants = list(seen.values())[: args.limit] if args.limit else list(seen.values())
    print(f"  ✓ {len(tenants):,} clubs Playtomic découverts")

    print("▶ détail + matching…")
    report = []
    matched = 0
    for t in tenants:
        detail = tenant_detail(t.get("tenant_id", "")) or t
        indoor, outdoor = parse_padel_courts(detail.get("resources", []))
        props = detail.get("properties") or {}
        m = best_match(detail, venues)
        if m:
            matched += 1
        report.append({
            "playtomic_id": detail.get("tenant_id"),
            "playtomic_name": detail.get("tenant_name"),
            "courts_indoor": indoor,
            "courts_outdoor": outdoor,
            "website_url": props.get("WEBSITE_URL") or None,
            "booking_url": playtomic_booking_url(detail),
            "match": m,
        })
        time.sleep(0.15)

    out = Path(args.out)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    pct = 100 * matched // max(1, len(report))

    if args.apply:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        n_refs, n_venues, n_links = apply_enrichment(url, key, report, now_iso)
        print(f"\n✅ APPLY — écriture DB effectuée.")
        print(f"   clubs Playtomic: {len(report)} · matchés: {matched} ({pct}%)")
        print(f"   external_ref: {n_refs} · venues enrichis: {n_venues} · "
              f"booking_link (affichés sur la fiche): {n_links}")
    else:
        print(f"\n✅ DRY-RUN — aucune écriture DB.")
        print(f"   clubs Playtomic: {len(report)} · matchés à un venue: {matched} ({pct}%)")
    print(f"   rapport: {out}")
    return 0


def self_test() -> int:
    # haversine : ~111 km par degré de latitude
    assert abs(haversine_m(48.0, 2.0, 49.0, 2.0) - 111_195) < 500, "haversine lat"
    assert haversine_m(48.85, 2.35, 48.85, 2.35) == 0.0
    # jaro_winkler : identité, proche, lointain
    assert jaro_winkler("Padel Club Paris", "Padel Club Paris") == 1.0
    assert jaro_winkler("RAWI CLUB", "Rawi Club") > 0.95, "accents/casse"
    assert jaro_winkler("Padel Aix", "Tennis Lyon") < 0.6
    # parse_padel_courts : compte indoor/outdoor, ignore non-padel + inactifs
    res = [
        {"sport_id": "PADEL", "is_active": True, "properties": {"resource_type": "indoor"}},
        {"sport_id": "PADEL", "is_active": True, "properties": {"resource_type": "outdoor"}},
        {"sport_id": "PADEL", "is_active": True, "properties": {"resource_type": "outdoor"}},
        {"sport_id": "TENNIS", "is_active": True, "properties": {"resource_type": "indoor"}},
        {"sport_id": "PADEL", "is_active": False, "properties": {"resource_type": "indoor"}},
    ]
    assert parse_padel_courts(res) == (1, 2), parse_padel_courts(res)

    # playtomic_booking_url : page club Playtomic, jamais le host api.* du détail.
    assert (
        playtomic_booking_url({"tenant_id": "abc", "url": "https://api.syltek.com"})
        == "https://playtomic.io/tenant/abc"
    )
    assert playtomic_booking_url({"url": "https://api.syltek.com"}) is None  # pas d'id
    # best_match : géo + nom
    club = {"tenant_name": "Padel Club Lyon",
            "address": {"coordinate": {"lat": 45.75, "lon": 4.85}}}
    venues = [
        {"id": "a", "name": "Padel Club Lyon", "lat": 45.7505, "lon": 4.8505},  # ~70m
        {"id": "b", "name": "Padel Club Lyon", "lat": 45.80, "lon": 4.90},      # trop loin
    ]
    m = best_match(club, venues)
    assert m and m["venue_id"] == "a", m

    # is_match : 2 paliers. Nom fort tolère l'écart géo ; nom faible exige la
    # proximité ; le faux positif observé (JW 0.856 @ 82 m) est rejeté.
    assert is_match(0.95, 250.0) is True      # nom fort, géo moyen → OK
    assert is_match(0.95, 320.0) is False     # nom fort mais trop loin
    assert is_match(0.89, 110.0) is True      # nom faible mais proche → OK
    assert is_match(0.89, 200.0) is False     # nom faible + écart → rejeté
    assert is_match(0.856, 82.0) is False     # faux positif "Tennis …" rejeté

    # is_fr_club : ne garde que la France (clubs frontaliers exclus).
    assert is_fr_club({"address": {"country_code": "FR"}}) is True
    assert is_fr_club({"address": {"country_code": "es"}}) is False  # casse + ES
    assert is_fr_club({}) is False  # pas d'adresse → exclu

    # ── Apply (PR C) : build des écritures, pur et idempotent ──────────────────
    report = [
        {"playtomic_id": "t1", "playtomic_name": "Padel Club Lyon",
         "courts_indoor": 2, "courts_outdoor": 3, "booking_url": "https://playtomic.io/t1",
         "website_url": "https://lyon.example", "match": {"venue_id": "v1", "distance_m": 12.0, "score": 0.97}},
        {"playtomic_id": "t2", "playtomic_name": "Sans Match",
         "courts_indoor": 0, "courts_outdoor": 1, "booking_url": None,
         "website_url": None, "match": None},
        # Doublon : 2 clubs visent v3 → seul le meilleur score patche le venue.
        {"playtomic_id": "t3", "playtomic_name": "A", "courts_indoor": 1, "courts_outdoor": 0,
         "booking_url": "https://playtomic.io/t3", "website_url": None,
         "match": {"venue_id": "v3", "distance_m": 50.0, "score": 0.88}},
        {"playtomic_id": "t4", "playtomic_name": "B", "courts_indoor": 4, "courts_outdoor": 0,
         "booking_url": "https://playtomic.io/t4", "website_url": None,
         "match": {"venue_id": "v3", "distance_m": 20.0, "score": 0.95}},
    ]
    refs = build_external_ref_rows(report, "2026-06-08T00:00:00+00:00")
    # 3 clubs matchés (t1, t3, t4) → 3 lignes external_ref ; t2 (no match) exclu.
    assert len(refs) == 3, refs
    assert {r["external_id"] for r in refs} == {"t1", "t3", "t4"}, refs
    assert all(r["source"] == "playtomic" and r["last_seen_at"] for r in refs)
    assert refs[0]["payload_json"]["match_score"] == 0.97

    patches = build_venue_patches(report)
    by_vid = dict(patches)
    # v1 enrichi ; v3 dédupé → patché par t4 (score 0.95 > 0.88), pas t3.
    assert set(by_vid) == {"v1", "v3"}, by_vid

    # build_booking_link_rows : ce que la fiche affiche (table booking_link).
    links = build_booking_link_rows(report)
    by_v = {l["venue_id"]: l for l in links}
    assert set(by_v) == {"v1", "v3"}, by_v  # t2 (no match) + dédup v3 → 2 liens
    assert by_v["v1"] == {
        "venue_id": "v1", "partner": "playtomic",
        "url": "https://playtomic.io/t1", "sport_slug": "padel", "is_active": True,
    }, by_v["v1"]
    assert by_v["v3"]["url"] == "https://playtomic.io/t4"  # meilleur score gagne
    assert by_vid["v1"] == {"booking_url": "https://playtomic.io/t1",
                            "courts_indoor": 2, "courts_outdoor": 3}, by_vid["v1"]
    assert by_vid["v3"]["courts_indoor"] == 4, by_vid["v3"]  # t4 a gagné
    # courts_* = 0 reste écrit (info valide, pas un None).
    rep0 = [{"playtomic_id": "z", "courts_indoor": 0, "courts_outdoor": 0,
             "booking_url": None, "match": {"venue_id": "vz", "score": 0.9}}]
    p0 = dict(build_venue_patches(rep0))
    assert p0["vz"] == {"courts_indoor": 0, "courts_outdoor": 0}, p0

    print("✓ scrape_playtomic_padel_fr self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Enrichissement padel FR via Playtomic (#345)")
    p.add_argument("--limit", type=int, default=None, help="Cap clubs (dry-run/test)")
    p.add_argument("--out", default="/tmp/padel_playtomic_report.json")
    p.add_argument("--apply", action="store_true",
                   help="Écrit en DB (external_ref + venue). Sinon dry-run.")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
