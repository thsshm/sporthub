#!/usr/bin/env python3
"""
scrape_playtomic_padel_fr.py — enrichissement padel FR depuis Playtomic (#345).

Playtomic expose une API publique interrogeable en HTTP simple (spike #345 — PAS
de Bright Data) :
  - Discovery : GET api.playtomic.io/v1/tenants?sport_id=PADEL&coordinate=lat,lon
               &radius=<m>&size=<n>  → liste de clubs (tenant_id, nom, adresse).
  - Détail    : GET api.playtomic.io/v1/tenants/{id}  → resources[] (courts
               indoor/outdoor), properties.WEBSITE_URL / CONTACT_PHONE, slug/url.

Ce script (PR B) tourne en DRY-RUN : il découvre les clubs Playtomic sur une
grille FR, les apparie à nos venues padel (géo < seuil + Jaro-Winkler nom), et
écrit un RAPPORT de correspondances (JSON) à spot-checker. AUCUNE écriture DB.
PR C ajoutera l'UPDATE venue + external_ref derrière --apply.

Usage :
    python3 scripts/scrape_playtomic_padel_fr.py --self-test
    python3 scripts/scrape_playtomic_padel_fr.py --limit 30 --out /tmp/padel.json
    python3 scripts/scrape_playtomic_padel_fr.py            # grille FR complète

Stdlib only (urllib, json, math) — comme osm/overture_import.
"""
from __future__ import annotations

import argparse
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

# Seuils de matching (#345 D4 — ajustables après revue du rapport).
GEO_THRESHOLD_M = 100.0
NAME_THRESHOLD = 0.85

# Grille de découverte couvrant la France métropolitaine (bbox), pas ~0.5°
# (~55 km) avec un rayon de recherche de 40 km → recouvrement. Le dédup par
# tenant_id élimine les doublons entre cellules voisines.
FR_BBOX = (41.3, -5.1, 51.1, 9.6)  # (S, W, N, E)
GRID_STEP_DEG = 0.5
SEARCH_RADIUS_M = 40_000


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


def load_padel_venues_fr(url: str, key: str) -> list[dict]:
    """Charge les venues padel FR (id, name, lat, lon) via PostgREST (keyset)."""
    venues: list[dict] = []
    last = ""
    while True:
        path = (
            f"venue?select=id,name,lat,lon,venue_sport!inner(sport_slug)"
            f"&venue_sport.sport_slug=eq.padel&country_code=eq.FR"
            f"&is_published=eq.true&deleted_at=is.null"
            f"&order=id.asc&limit=1000"
        )
        if last:
            path += f"&id=gt.{last}"
        req = urllib.request.Request(
            f"{url}/rest/v1/{path}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            rows = json.loads(resp.read())
        if not rows:
            break
        venues.extend(rows)
        last = rows[-1]["id"]
        if len(rows) < 1000:
            break
    return venues


def best_match(club: dict, venues: list[dict]) -> dict | None:
    """Meilleur venue pour un club Playtomic : géo < seuil ET Jaro-Winkler max."""
    addr = club.get("address") or {}
    coord = addr.get("coordinate") or {}
    clat, clon = coord.get("lat"), coord.get("lon")
    if clat is None or clon is None:
        return None
    cname = club.get("tenant_name") or ""
    best = None
    for v in venues:
        d = haversine_m(clat, clon, v["lat"], v["lon"])
        if d > GEO_THRESHOLD_M:
            continue
        score = jaro_winkler(cname, v.get("name") or "")
        if score >= NAME_THRESHOLD and (best is None or score > best["score"]):
            best = {"venue_id": v["id"], "venue_name": v.get("name"),
                    "distance_m": round(d, 1), "score": round(score, 3)}
    return best


# ── Pipeline dry-run ───────────────────────────────────────────────────────────
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
            if tid and tid not in seen:
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
            "booking_url": detail.get("url") or (
                f"https://playtomic.io/{detail.get('slug')}" if detail.get("slug") else None
            ),
            "match": m,
        })
        time.sleep(0.15)

    out = Path(args.out)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\n✅ DRY-RUN — aucune écriture DB.")
    print(f"   clubs Playtomic: {len(report)} · matchés à un venue: {matched} "
          f"({100*matched//max(1,len(report))}%)")
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
    # best_match : géo + nom
    club = {"tenant_name": "Padel Club Lyon",
            "address": {"coordinate": {"lat": 45.75, "lon": 4.85}}}
    venues = [
        {"id": "a", "name": "Padel Club Lyon", "lat": 45.7505, "lon": 4.8505},  # ~70m
        {"id": "b", "name": "Padel Club Lyon", "lat": 45.80, "lon": 4.90},      # trop loin
    ]
    m = best_match(club, venues)
    assert m and m["venue_id"] == "a", m
    print("✓ scrape_playtomic_padel_fr self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Enrichissement padel FR via Playtomic (#345)")
    p.add_argument("--limit", type=int, default=None, help="Cap clubs (dry-run/test)")
    p.add_argument("--out", default="/tmp/padel_playtomic_report.json")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
