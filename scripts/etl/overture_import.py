#!/usr/bin/env python3
"""
etl/overture_import.py — Importeur Overture Maps → Supabase (#227, tranche 227.5).

Lit les POI Overture Maps (dataset Apache 2.0 / ODbL) depuis S3 public via
DuckDB + httpfs, mappe vers VenueRecord, et upsert idempotent via etl_upsert.py.

Avantage vs Overpass : Overture couvre le monde entier de façon uniforme,
sans rate-limit, et inclut les données Facebook/Meta pour fitness/gym (très
bien couverts) + les POI locaux mal tagués dans OSM. Complémentaire à l'import
OSM.

Source : s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/
Lecture via DuckDB + httpfs (accès anonyme, aucune clé AWS).
Le dataset est trié spatialement → un filtre bbox élague les Parquet
(footer stats) et rend la requête France rapide (~30–60 s selon la famille).

Dépendances : duckdb (pip install duckdb). Séparée des autres scripts pour
ne pas exiger duckdb partout (scripts stdlib-only).

Usage :
    pip install --break-system-packages duckdb
    python3 scripts/etl/overture_import.py --family fitness --country FR --dry-run
    python3 scripts/etl/overture_import.py --family fitness --country FR

    # Via GH Actions (disponible dans le workflow overture-import.yml)
    gh workflow run overture-import.yml -f family=fitness -f country=FR -f apply=false

Options :
    --family    fitness|ballon|yoga|nautique|plus|all (catégories Overture bien couvertes)
    --country   ISO-2 (FR, ES, DE, …) ou EU
    --release   Overture release (défaut : auto-détect la plus récente)
    --limit     Cap venues (test)
    --dry-run   Aucune écriture DB
    --self-test Tests logique pure sans réseau ni duckdb
"""
from __future__ import annotations

import argparse
import os
import sys
import json
import urllib.request
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))
from etl_upsert import (  # noqa: E402
    SupabaseRestClient,
    VenueRecord,
    UpsertResult,
    open_import_run,
    close_import_run,
    upsert_venues_batch,
    soft_delete_missing,
)
from cleaning import is_misclassified  # noqa: E402  (sibling, scripts/etl sur sys.path)

SOURCE = "overture"

# Overture release S3 path (mise à jour trimestrielle)
# Format : s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/
# La release la plus récente est détectable via le manifeste Overture public.
DEFAULT_RELEASE = "2026-05-20.0"  # release valide récente (cf. #94 : 2025-05-21.0 périmée → S3 vide)
# TODO : auto-détecter la plus récente (lister s3://…/release/) pour éviter de re-périmer.

# Bboxes (S, W, N, E) — identiques à osm_import pour cohérence
COUNTRY_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "FR": (41.3, -5.1, 51.1, 9.6),
    "ES": (35.9, -9.3, 43.8, 4.3),
    "DE": (47.3, 5.9, 55.0, 15.0),
    "IT": (36.6, 6.7, 47.1, 18.5),
    "GB": (49.9, -8.2, 60.9, 1.8),
    "EU": (34.0, -25.0, 72.0, 45.0),
    # Pilote hors-Europe (#227 extension mondiale) — (S, W, N, E).
    "US": (24.4, -125.0, 49.4, -66.9),   # contiguous (hors AK/HI)
    "CA": (41.7, -141.0, 83.1, -52.6),
    "BR": (-33.8, -73.9, 5.3, -34.8),
    "AU": (-43.6, 113.3, -10.7, 153.6),
    "JP": (24.0, 122.9, 45.6, 145.8),
}

# Catégories Overture réelles (vérifiées sur release 2025-05-21.0).
# Clé : (overture_category,) → (family_slug, sport_slug).
# Les catégories Overture sont des slugs kebab-case.
OVERTURE_CATEGORY_MAP: dict[str, tuple[str, str]] = {
    # Fitness (bien couvert dans Overture — Meta/FB data)
    "fitness_center":        ("fitness", "gym"),
    "gym":                   ("fitness", "gym"),
    "yoga_studio":           ("yoga", "yoga"),
    "pilates_studio":        ("fitness", "pilates"),
    "dance_studio":          ("fitness", "dance"),
    # Sport raquette
    "tennis_court":          ("raquette", "tennis"),
    "badminton_court":       ("raquette", "badminton"),
    # Aquatique
    "swimming_pool":         ("baignade", "pool"),
    "water_park":            ("baignade", "pool"),
    # Bien-être
    "spa":                   ("yoga", "spa"),
    "sauna":                 ("yoga", "sauna"),
    # Nautique
    "marina":                ("nautique", "marina"),
    "surf_shop":             ("nautique", "surf"),
    "diving_center":         ("nautique", "diving"),
    # Ballon
    "soccer_field":          ("ballon", "football"),
    "basketball_court":      ("ballon", "basketball"),
    "volleyball_court":      ("ballon", "volleyball"),
    "rugby_field":           ("ballon", "rugby"),
    # Plus
    "golf_course":           ("plus", "golf"),
    "equestrian":            ("plus", "equestrian"),
    "climbing_gym":          ("escalade", "climbing_indoor"),
    "skate_park":            ("glisse", None),   # pas de slug 'glisse'/'skateboard' dans `sport` (FK) → NULL
    "ski_resort":            ("snow", "skiing"),
    "bowling_alley":         ("plus", "plus"),
    # Combat (#94 — vérifiées par dry-run FR. sport_slug doit exister dans la
    # table `sport` (FK) : slugs combat valides = boxing/judo/karate/mma/bjj.
    # martial_arts_club (générique) & kickboxing → None (famille suffit, pas de
    # mislabel ; primary_sport_slug NULL = pas de violation FK 23503).
    "martial_arts_club":     ("combat", None),   # ~11.9k FR (générique)
    "boxing_gym":            ("combat", "boxing"),
    "karate_club":           ("combat", "karate"),
    "kickboxing_club":       ("combat", None),
}

# Familles supportées (celles bien couvertes dans Overture)
FAMILY_CATEGORIES: dict[str, list[str]] = {
    "fitness": ["fitness_center", "gym", "pilates_studio", "dance_studio"],
    "yoga":    ["yoga_studio", "spa", "sauna"],
    "baignade":["swimming_pool", "water_park"],
    "nautique":["marina", "diving_center", "surf_shop"],
    "ballon":  ["soccer_field", "basketball_court", "volleyball_court", "rugby_field"],
    "raquette":["tennis_court", "badminton_court"],
    "escalade":["climbing_gym"],
    "glisse":  ["skate_park"],
    "snow":    ["ski_resort"],
    "plus":    ["golf_course", "equestrian"],
    "combat":  ["martial_arts_club", "boxing_gym", "karate_club", "kickboxing_club"],
}


def get_overture_s3_path(release: str) -> str:
    return f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/"


def build_duckdb_query(
    s3_path: str,
    categories: list[str],
    bbox: tuple[float, float, float, float],
    limit: int | None = None,
) -> str:
    """Requête DuckDB pour lire les POI Overture filtrés par catégorie + bbox."""
    s, w, n, e = bbox
    cats_sql = ", ".join(f"'{c}'" for c in categories)
    limit_clause = f"LIMIT {limit}" if limit else ""
    return f"""
    LOAD httpfs;
    SET s3_region='us-west-2';
    SELECT
      id,
      names.primary AS name,
      ST_Y(geometry) AS lat,
      ST_X(geometry) AS lon,
      categories.primary AS category,
      addresses[1].country AS country_code,
      addresses[1].freeform AS address
    FROM read_parquet('{s3_path}**', hive_partitioning=1)
    WHERE categories.primary IN ({cats_sql})
      AND ST_Y(geometry) BETWEEN {s} AND {n}
      AND ST_X(geometry) BETWEEN {w} AND {e}
      AND names.primary IS NOT NULL
    {limit_clause}
    """


def rows_to_records(
    rows: list[dict[str, Any]],
    family_slug: str,
    sport_slug: str,
) -> list[VenueRecord]:
    """Convertit les lignes DuckDB en VenueRecord."""
    records = []
    for row in rows:
        name = (row.get("name") or "").strip()
        lat = row.get("lat")
        lon = row.get("lon")
        ext_id = row.get("id")
        if not name or lat is None or lon is None or not ext_id:
            continue
        try:
            lat_f, lon_f = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            continue
        # #463 — écarte les POI Overture visiblement mal classés (catégorie
        # Overture grossière → nom signalant un sport d'une autre famille,
        # ex. pêche/golf/boules sur un sport de raquette).
        if is_misclassified(name, sport_slug):
            continue
        records.append(VenueRecord(
            source=SOURCE,
            external_id=f"overture/{ext_id}",
            name=name,
            lat=lat_f,
            lon=lon_f,
            family_slug=family_slug,
            primary_sport_slug=sport_slug,
            address=(row.get("address") or None),
            country_code=(row.get("country_code") or None),
        ))
    return records


def fetch_family_records_overture(
    family: str,
    bbox: tuple[float, float, float, float],
    release: str,
    limit: int | None,
) -> list[VenueRecord]:
    """Importe les POI Overture pour une famille via DuckDB."""
    try:
        import duckdb  # noqa: PLC0415
    except ImportError:
        print("❌ pip install duckdb", file=sys.stderr)
        raise SystemExit(1)

    categories = FAMILY_CATEGORIES.get(family, [])
    if not categories:
        return []

    s3_path = get_overture_s3_path(release)
    query = build_duckdb_query(s3_path, categories, bbox, limit)

    conn = duckdb.connect()
    # #94 — les DuckDB récents n'auto-chargent plus `spatial` ; ST_X/ST_Y de la
    # requête échouent ("not in the catalog") sans LOAD explicite.
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute("INSTALL spatial; LOAD spatial;")
    conn.execute("SET s3_region='us-west-2';")

    rows_all: list[VenueRecord] = []
    for cat in categories:
        q = build_duckdb_query(s3_path, [cat], bbox, limit)
        try:
            result = conn.execute(q).fetchall()
            cols = [d[0] for d in conn.description or []]
            raw_rows = [dict(zip(cols, r)) for r in result]
            family_slug, sport_slug = OVERTURE_CATEGORY_MAP.get(cat, (family, cat))
            rows_all.extend(rows_to_records(raw_rows, family_slug, sport_slug))
            print(f"    {cat}: {len(raw_rows)} POI", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ erreur {cat}: {e}", flush=True)

    conn.close()
    return rows_all


def load_env_client() -> SupabaseRestClient:
    env: dict[str, str] = {}
    env_file = _REPO_ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (env.get("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or
           os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return SupabaseRestClient(url, key)


def run(args: argparse.Namespace) -> int:
    families = list(FAMILY_CATEGORIES.keys()) if args.family == "all" else [args.family]
    bbox = COUNTRY_BBOXES.get(args.country.upper())
    if bbox is None:
        print(f"❌ Pays inconnu : {args.country}", file=sys.stderr)
        return 1

    scope = f"{args.family}/{args.country.upper()}"
    mode = "DRY-RUN" if args.dry_run else "APPLY"
    print(f"▶ overture_import {scope} · {mode} · release={args.release}")

    if not args.dry_run:
        client = load_env_client()

    run_id: str | None = None
    total = UpsertResult()
    all_seen: set[str] = set()

    for family in families:
        print(f"\n  📦 famille : {family}")
        records = fetch_family_records_overture(family, bbox, args.release, args.limit)
        print(f"  ✓ {len(records):,} records trouvés")

        if args.dry_run:
            print(f"  [DRY-RUN] {len(records):,} records (aucune écriture)")
            continue

        if run_id is None:
            run_id = open_import_run(client, SOURCE, scope, runner="local")

        result = upsert_venues_batch(client, records, chunk_size=args.chunk)
        total = total.merge(result)
        all_seen.update(r.external_id for r in records)
        print(f"  ✓ upserted={result.upserted} skipped={result.skipped}")
        for e in result.errors[:3]:
            print(f"    ⚠ {e}")

    soft_deleted = 0
    if run_id and args.country.upper() != "EU" and all_seen:
        # #426/#445 — scope par famille pour un import mono-famille (sinon on
        # soft-delete les autres familles, source+pays, absentes de ce batch).
        # `None` pour --family all = réconciliation complète.
        fam_scope = None if args.family == "all" else args.family
        soft_deleted = soft_delete_missing(
            client, SOURCE, args.country.upper(), all_seen, family_slug=fam_scope,
        )
        print(f"\n  🗑 soft-deleted={soft_deleted}")

    if run_id:
        err = "; ".join(total.errors[:3]) or None
        close_import_run(client, run_id, total, soft_deleted=soft_deleted, error=err)
        print(f"\n✅ terminé · upserted={total.upserted}")

    return 0


def self_test() -> int:
    """Tests sur la logique pure (sans réseau, sans duckdb)."""
    # build_duckdb_query : structure de la requête
    q = build_duckdb_query("s3://test/", ["fitness_center", "gym"],
                           (41.0, -5.0, 51.0, 9.0), limit=100)
    assert "fitness_center" in q
    assert "gym" in q
    assert "41.0" in q and "9.0" in q
    assert "LIMIT 100" in q
    assert "names.primary" in q

    # rows_to_records : mapping correct
    rows = [
        {"id": "abc123", "name": "Fitness Paris", "lat": 48.85, "lon": 2.35,
         "country_code": "FR", "address": "1 rue X"},
        {"id": "def456", "name": None, "lat": 48.0, "lon": 2.0},  # sans nom → skip
        {"id": "ghi789", "name": "Club", "lat": 999.0, "lon": 2.0},  # coords invalides
    ]
    records = rows_to_records(rows, "fitness", "gym")
    assert len(records) == 1
    assert records[0].external_id == "overture/abc123"
    assert records[0].name == "Fitness Paris"
    assert records[0].source == "overture"
    assert records[0].country_code == "FR"

    # FAMILY_CATEGORIES : toutes les catégories dans OVERTURE_CATEGORY_MAP
    for fam, cats in FAMILY_CATEGORIES.items():
        for cat in cats:
            assert cat in OVERTURE_CATEGORY_MAP, f"OVERTURE_CATEGORY_MAP manque {cat}"

    # get_overture_s3_path
    path = get_overture_s3_path("2025-01-01.0")
    assert "overturemaps" in path and "2025-01-01.0" in path

    print("✓ overture_import self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Import Overture Maps → Supabase (#227.5)")
    p.add_argument("--family", choices=[*sorted(FAMILY_CATEGORIES.keys()), "all"],
                   default="fitness")
    p.add_argument("--country", default="FR")
    p.add_argument("--release", default=DEFAULT_RELEASE)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--chunk", type=int, default=100)
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
