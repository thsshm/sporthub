#!/usr/bin/env python3
"""
backfill_venue_city.py — rattache chaque venue à sa ville (`city_id`).

Problème (diagnostic 2026-06-08) : la quasi-totalité des venues ont `city_id`
NULL → les pages programmatiques sport×ville (`/[sport]/[pays]/[ville]`) filtrent
sur `city_id` et affichent donc 0 lieu alors que les données existent (ex. 329
venues tennis géographiquement à Lyon, 0 sur la page). Tout le SEO programmatique
est neutralisé.

Fix : pour chaque venue SANS `city_id`, assigner la **ville la plus proche** de la
table `city` (même pays) dans un rayon de `MAX_KM` (défaut 5 km, décision @thsshm).
On ne touche JAMAIS un `city_id` déjà renseigné → idempotent et conservateur.

Écriture par lots groupés par ville (PATCH `venue?id=in.(…)` SET city_id) — pattern
éprouvé (`backfill_courts_count_rest.py` #274), sous le statement_timeout.

Usage :
    python3 scripts/backfill_venue_city.py --self-test
    python3 scripts/backfill_venue_city.py                 # DRY-RUN (aucune écriture)
    python3 scripts/backfill_venue_city.py --apply         # écrit en DB

Env (GitHub Actions) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
Stdlib only (urllib, json, math).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MAX_KM = 5.0
# Taille de cellule de la grille spatiale. 0.05° ≈ 5.5 km en latitude → le
# voisinage 3×3 (cellule + 8 adjacentes) couvre un rayon de 5 km partout.
CELL_DEG = 0.05

# Seules villes françaises à arrondissements. Leurs venues (souvent ex-RES) sont
# rattachés à des fiches-ville `<base>-NN` (ex. lyon-06) au lieu de la ville
# parente → la page /[sport]/fr/lyon les rate. On les re-rattache au parent.
ARRONDISSEMENT_BASES = ("paris", "lyon", "marseille")
_ARR_RE = re.compile(r"^([a-z]+(?:-[a-z]+)*)-(\d{1,2})$")


# ── Géo + index spatial (pur, testé) ───────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def cell_key(lat: float, lon: float) -> tuple[int, int]:
    return (math.floor(lat / CELL_DEG), math.floor(lon / CELL_DEG))


def build_city_index(cities: list[dict]) -> dict[tuple[int, int], list[dict]]:
    """Indexe les villes par cellule de grille pour une recherche du plus proche
    en O(voisinage) au lieu de O(toutes les villes)."""
    index: dict[tuple[int, int], list[dict]] = {}
    for c in cities:
        if c.get("lat") is None or c.get("lon") is None:
            continue
        index.setdefault(cell_key(c["lat"], c["lon"]), []).append(c)
    return index


def nearest_city_id(
    index: dict[tuple[int, int], list[dict]],
    lat: float,
    lon: float,
    country: str | None,
    max_km: float = MAX_KM,
) -> str | None:
    """id de la ville la plus proche (même pays si `country` fourni) dans
    `max_km`, sinon None. Ne scanne que le voisinage 3×3 de la cellule."""
    ck = cell_key(lat, lon)
    best_id: str | None = None
    best_d = max_km
    for dlat in (-1, 0, 1):
        for dlon in (-1, 0, 1):
            for c in index.get((ck[0] + dlat, ck[1] + dlon), ()):
                if country and c.get("country_code") and c["country_code"] != country:
                    continue
                d = haversine_km(lat, lon, c["lat"], c["lon"])
                if d <= best_d:
                    best_d = d
                    best_id = c["id"]
    return best_id


def plan_assignments(
    venues: list[dict],
    index: dict[tuple[int, int], list[dict]],
    max_km: float = MAX_KM,
) -> dict[str, str]:
    """{venue_id: city_id} pour les venues qu'on peut rattacher (pur, testable)."""
    out: dict[str, str] = {}
    for v in venues:
        if v.get("lat") is None or v.get("lon") is None:
            continue
        cid = nearest_city_id(index, v["lat"], v["lon"], v.get("country_code"), max_km)
        if cid:
            out[v["id"]] = cid
    return out


def arrondissement_parent_map(cities: list[dict]) -> dict[str, str]:
    """{city_id arrondissement: city_id ville parente} (pur, testable).

    Un arrondissement = slug `<base>-NN` avec `base` ∈ ARRONDISSEMENT_BASES et une
    ville `<base>` existante dans le même pays. (Restreint à Paris/Lyon/Marseille
    pour ne JAMAIS fusionner par erreur une vraie ville nommée `xxx-NN`.)"""
    id_by_slug_country: dict[tuple[str | None, str | None], str] = {}
    for c in cities:
        id_by_slug_country[(c.get("slug"), c.get("country_code"))] = c["id"]
    out: dict[str, str] = {}
    for c in cities:
        m = _ARR_RE.match(c.get("slug") or "")
        if not m or m.group(1) not in ARRONDISSEMENT_BASES:
            continue
        parent = id_by_slug_country.get((m.group(1), c.get("country_code")))
        if parent and parent != c["id"]:
            out[c["id"]] = parent
    return out


# ── REST Supabase (service-role) ────────────────────────────────────────────────
def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    f = Path(__file__).resolve().parent.parent / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (os.getenv("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
           or env.get("SUPABASE_URL", ""))
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return url.rstrip("/"), key


def req(url, key, method="GET", path="", body=None, prefer=None, timeout=120, retries=5):
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, data=data,
                                       headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise last


def load_cities(url, key) -> list[dict]:
    rows, last_id, page = [], "", 1000
    while True:
        path = f"city?select=id,slug,country_code,lat,lon&order=id.asc&limit={page}"
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(chunk) < page:
            break
    return rows


def fetch_unlinked_venues(url, key, limit=None) -> list[dict]:
    """Venues publiées, non supprimées, SANS city_id et avec coordonnées."""
    rows, last_id, page = [], "", 1000
    while True:
        path = (f"venue?select=id,lat,lon,country_code&city_id=is.null"
                f"&is_published=eq.true&deleted_at=is.null"
                f"&lat=not.is.null&lon=not.is.null&order=id.asc&limit={page}")
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(rows) % 50000 < page:
            print(f"    … {len(rows):,} venues sans city_id chargées", flush=True)
        if len(chunk) < page:
            break
    return rows


def apply_assignments(url, key, assignments: dict[str, str], chunk=120) -> int:
    """PATCH groupés PAR ville : venue?id=in.(ids) SET city_id=<city>."""
    by_city: dict[str, list[str]] = {}
    for vid, cid in assignments.items():
        by_city.setdefault(cid, []).append(vid)
    written = 0
    for cid, ids in by_city.items():
        for i in range(0, len(ids), chunk):
            batch = ids[i:i + chunk]
            path = f"venue?id=in.({','.join(batch)})"
            req(url, key, method="PATCH", path=path,
                body={"city_id": cid}, prefer="return=minimal")
            written += len(batch)
    return written


# ── Diagnostic (lecture seule) ──────────────────────────────────────────────────
def diagnose(args: argparse.Namespace) -> int:
    """Pour un bbox + sport (primary), reporte à quelles VILLES les venues sont
    rattachés (city_id→slug), + le nb sans city_id. Révèle les mismatches du type
    'tennis Lyon = 0' (venues rattachés à des arrondissements/doublons, pas à la
    ville de la page). Aucune écriture."""
    import collections

    url, key = load_env()
    cities = load_cities(url, key)
    slug_by_id = {c["id"]: c.get("slug") for c in cities}
    w, s, e, n = [float(x) for x in args.bbox.split(",")]
    print(f"▶ venues primary_sport={args.sport} dans bbox {args.bbox}…")
    rows, last_id, page = [], "", 1000
    while True:
        path = (
            f"venue?select=id,city_id&primary_sport_slug=eq.{args.sport}"
            f"&lat=gte.{s}&lat=lte.{n}&lon=gte.{w}&lon=lte.{e}"
            f"&is_published=eq.true&deleted_at=is.null&order=id.asc&limit={page}"
        )
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(chunk) < page:
            break
    dist = collections.Counter(
        (slug_by_id.get(r["city_id"]) if r.get("city_id") else "∅ NULL")
        for r in rows
    )
    print(f"  ✓ {len(rows)} venues. Rattachement par ville (city slug → nb) :")
    for slug, count in dist.most_common(20):
        print(f"     {count:5}  {slug}")
    return 0


def diag_page(args: argparse.Namespace) -> int:
    """Reproduit la résolution de /[sport]/fr/<ville> : résout TOUTES les lignes
    `city` (country+slug) — révèle les DOUBLONS de ville — puis compte, par
    city_id, les venues `primary_sport_slug=<sport>` publiées (ce que la page
    liste). Si deux lignes 'paris' existent et que les venues pendent sur l'une
    pendant que la page résout l'autre → page vide malgré la data. Aucune écriture."""
    url, key = load_env()
    country = args.country.upper()
    slug = args.city_slug
    rows = json.loads(req(
        url, key,
        path=(f"city?select=id,name,slug,lat,lon&country_code=eq.{country}"
              f"&slug=eq.{slug}&order=id.asc"),
    ))
    print(f"▶ city country={country} slug={slug} → {len(rows)} ligne(s) :")
    if not rows:
        print("  ⚠ aucune ville ne matche ce slug — la page renverrait 404.")
        return 0
    for i, c in enumerate(rows):
        # fetch ids (publiés, sport) → len = ce que la page compterait pour ce city_id
        n, last_id = 0, ""
        while True:
            path = (f"venue?select=id&primary_sport_slug=eq.{args.sport}"
                    f"&city_id=eq.{c['id']}&is_published=eq.true&deleted_at=is.null"
                    f"&order=id.asc&limit=1000")
            if last_id:
                path += f"&id=gt.{last_id}"
            chunk = json.loads(req(url, key, path=path))
            if not chunk:
                break
            n += len(chunk)
            last_id = chunk[-1]["id"]
            if len(chunk) < 1000:
                break
        # Ce que la PAGE lit réellement : mv_venue_sport_search (pas la table venue).
        # Si l'écart venue↔MV est grand → MV périmée (refresh hebdo en retard).
        mv = 0
        try:
            mvrows = json.loads(req(
                url, key,
                path=(f"mv_venue_sport_search?select=venue_id&sport_slug=eq.{args.sport}"
                      f"&city_id=eq.{c['id']}&limit=10000"),
            ))
            mv = len(mvrows)
        except Exception as exc:  # noqa: BLE001
            mv = f"erreur ({exc})"
        # REPRODUIT EXACTEMENT getVisibleVenueCount : count=exact + head (#556).
        # Sans index (sport_slug, city_id) ce COUNT(*) scanne tout le sport →
        # timeout sur gym (140k) → erreur → la page affiche 0. On chronomètre.
        headers = {"apikey": key, "Authorization": "Bearer " + key,
                   "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"}
        path = (f"mv_venue_sport_search?select=venue_id&sport_slug=eq.{args.sport}"
                f"&city_id=eq.{c['id']}")
        t0 = time.monotonic()
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, headers=headers)
            with urllib.request.urlopen(r, timeout=60) as resp:
                cr = resp.headers.get("Content-Range", "?")
                cnt_exact = f"{resp.status} Content-Range={cr}"
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200]
            cnt_exact = f"ERREUR HTTP {e.code} : {body}"
        except Exception as e:  # noqa: BLE001
            cnt_exact = f"ERREUR {e}"
        dt = time.monotonic() - t0
        print(f"      → COUNT(*) exact (= getVisibleVenueCount) : {cnt_exact}  [{dt:.1f}s]")
        marker = "  ⟵ résolue par la page (1ʳᵉ par id.asc)" if i == 0 else ""
        print(f"  [{i}] id={c['id']} name={c['name']!r} "
              f"lat={c['lat']} lon={c['lon']} → table venue={n} | "
              f"MV (ce que lit la page)={mv}{marker}")
    if len(rows) > 1:
        print("\n  ⚠ DOUBLON détecté : plusieurs lignes city pour ce slug. La page "
              "n'en lit qu'une → si la data pend sur une autre, page vide.")
    return 0


def fetch_venues_in_cities(url, key, city_ids: list[str]) -> list[dict]:
    """Venues (non supprimées) rattachées à l'une des `city_ids`."""
    rows, last_id, page = [], "", 1000
    ids = ",".join(city_ids)
    while True:
        path = (f"venue?select=id,city_id&city_id=in.({ids})"
                f"&deleted_at=is.null&order=id.asc&limit={page}")
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(chunk) < page:
            break
    return rows


def consolidate_arrondissements(args: argparse.Namespace) -> int:
    """Re-rattache les venues des arrondissements (Paris/Lyon/Marseille) à la
    ville parente, pour que /[sport]/fr/<ville> les montre. Dry-run par défaut."""
    import collections

    url, key = load_env()
    cities = load_cities(url, key)
    slug_by_id = {c["id"]: c.get("slug") for c in cities}
    parent_of = arrondissement_parent_map(cities)
    print(f"▶ {len(parent_of)} fiches-arrondissement détectées "
          f"(parents : {sorted({slug_by_id.get(p) for p in parent_of.values()})})")
    if not parent_of:
        print("  (rien à consolider)")
        return 0

    venues = fetch_venues_in_cities(url, key, list(parent_of))
    assignments = {
        v["id"]: parent_of[v["city_id"]]
        for v in venues
        if v.get("city_id") in parent_of
    }
    by_parent = collections.Counter(slug_by_id.get(cid) for cid in assignments.values())
    print(f"  venues à re-rattacher : {len(assignments):,}")
    for slug, n in by_parent.most_common():
        print(f"     {n:6}  → {slug}")

    if args.apply:
        written = apply_assignments(url, key, assignments, chunk=args.chunk)
        print(f"\n✅ APPLY — {written:,} venues re-rattachés à leur ville parente.")
    else:
        print("\n✅ DRY-RUN — aucune écriture. Relancer avec --apply pour écrire.")
    return 0


# ── Pipeline ────────────────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> int:
    url, key = load_env()
    print("▶ chargement des villes…")
    cities = load_cities(url, key)
    index = build_city_index(cities)
    print(f"  ✓ {len(cities):,} villes ({len(index):,} cellules)")

    print("▶ chargement des venues sans city_id…")
    venues = fetch_unlinked_venues(url, key, limit=args.limit)
    print(f"  ✓ {len(venues):,} venues à rattacher")

    print(f"▶ calcul du plus proche (≤ {args.max_km} km)…")
    assignments = plan_assignments(venues, index, args.max_km)
    # Durcissement : ne JAMAIS laisser un venue sur une fiche-arrondissement
    # (paris-16…) — qui est souvent la ville la plus proche du centroïde — mais
    # directement la ville parente, pour que /[sport]/fr/paris les voie. Évite de
    # devoir relancer --consolidate-arr après chaque backfill (anti whack-a-mole).
    parent_of = arrondissement_parent_map(cities)
    if parent_of:
        assignments = {vid: parent_of.get(cid, cid) for vid, cid in assignments.items()}
    n = len(assignments)
    pct = 100 * n // max(1, len(venues))
    # Distribution par ville (top) pour spot-check.
    per_city: dict[str, int] = {}
    for cid in assignments.values():
        per_city[cid] = per_city.get(cid, 0) + 1
    top = sorted(per_city.items(), key=lambda x: -x[1])[:10]

    print(f"\n  venues rattachables : {n:,}/{len(venues):,} ({pct}%) · "
          f"villes touchées : {len(per_city):,}")
    print(f"  hors rayon (aucune ville ≤ {args.max_km} km) : {len(venues) - n:,}")
    print(f"  top villes (city_id → nb venues) : {top}")

    if args.apply:
        print("\n▶ écriture (PATCH groupés par ville)…")
        written = apply_assignments(url, key, assignments, chunk=args.chunk)
        print(f"✅ APPLY — {written:,} venues rattachés à leur ville.")
    else:
        print("\n✅ DRY-RUN — aucune écriture. Relancer avec --apply pour écrire.")
    return 0


def self_test() -> int:
    # haversine : ~111 km / degré de latitude
    assert abs(haversine_km(48.0, 2.0, 49.0, 2.0) - 111.2) < 1.0
    assert haversine_km(48.85, 2.35, 48.85, 2.35) == 0.0
    assert cell_key(48.86, 2.35) == (math.floor(48.86 / 0.05), math.floor(2.35 / 0.05))

    cities = [
        {"id": "lyon", "country_code": "FR", "lat": 45.76, "lon": 4.84},
        {"id": "madrid", "country_code": "ES", "lat": 40.42, "lon": -3.70},
        {"id": "paris", "country_code": "FR", "lat": 48.857, "lon": 2.352},
    ]
    idx = build_city_index(cities)
    # Venue à ~1 km de Lyon, FR → Lyon
    assert nearest_city_id(idx, 45.766, 4.845, "FR", 5.0) == "lyon"
    # Venue à ~1 km de Lyon mais pays ES → pas de match FR proche → None
    assert nearest_city_id(idx, 45.766, 4.845, "ES", 5.0) is None
    # Venue à >50 km de toute ville → None
    assert nearest_city_id(idx, 46.50, 5.50, "FR", 5.0) is None
    # Venue à ~300 m de Paris → Paris
    assert nearest_city_id(idx, 48.859, 2.353, "FR", 5.0) == "paris"

    venues = [
        {"id": "v1", "lat": 45.766, "lon": 4.845, "country_code": "FR"},  # → lyon
        {"id": "v2", "lat": 46.50, "lon": 5.50, "country_code": "FR"},    # hors rayon
        {"id": "v3", "lat": 48.859, "lon": 2.353, "country_code": "FR"},  # → paris
        {"id": "v4", "lat": None, "lon": None, "country_code": "FR"},     # pas de coords
    ]
    plan = plan_assignments(venues, idx, 5.0)
    assert plan == {"v1": "lyon", "v3": "paris"}, plan

    # arrondissement_parent_map : lyon-06 → lyon ; base hors liste ou parent
    # absent → ignoré (jamais de fusion par erreur).
    arr_cities = [
        {"id": "lyon", "slug": "lyon", "country_code": "FR"},
        {"id": "lyon6", "slug": "lyon-06", "country_code": "FR"},
        {"id": "paris16", "slug": "paris-16", "country_code": "FR"},
        {"id": "marseille8", "slug": "marseille-08", "country_code": "FR"},
        {"id": "orphan", "slug": "lyon-99", "country_code": "ES"},   # parent ES absent
        {"id": "bdx2", "slug": "bordeaux-2", "country_code": "FR"},  # base hors liste
    ]
    amap = arrondissement_parent_map(arr_cities)
    assert amap == {"lyon6": "lyon"}, amap

    print("✓ backfill_venue_city self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Rattache les venues à city_id (ville la plus proche)")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (sinon dry-run)")
    p.add_argument("--max-km", type=float, default=MAX_KM, help="Rayon max (défaut 5)")
    p.add_argument("--limit", type=int, default=None, help="Cap venues (smoke test)")
    p.add_argument("--chunk", type=int, default=120, help="ids par PATCH")
    p.add_argument("--diagnose", action="store_true",
                   help="Lecture seule : distribution city_id→slug pour --bbox/--sport")
    p.add_argument("--bbox", default="4.81,45.74,4.87,45.79",
                   help="W,S,E,N pour --diagnose (défaut : Lyon intra-muros)")
    p.add_argument("--sport", default="tennis", help="primary_sport_slug pour --diagnose/--diag-page")
    p.add_argument("--diag-page", action="store_true",
                   help="Lecture seule : reproduit la résolution de /[sport]/fr/<ville> (doublons city)")
    p.add_argument("--city-slug", default="paris", help="slug ville pour --diag-page")
    p.add_argument("--country", default="fr", help="country_code pour --diag-page")
    p.add_argument("--consolidate-arr", action="store_true",
                   help="Re-rattache les venues d'arrondissements (Paris/Lyon/Marseille) au parent")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.diagnose:
        return diagnose(args)
    if args.diag_page:
        return diag_page(args)
    if args.consolidate_arr:
        return consolidate_arrondissements(args)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
