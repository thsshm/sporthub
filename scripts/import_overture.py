#!/usr/bin/env python3
"""
import_overture.py — Import Overture Maps « places » (Fitness + Bien-être) → Supabase.

Issue #110 (phase 3, area:data). Top #2 ROI du DASHBOARD V1 : la V2 (fetch bbox
+ PostGIS + clustering MapLibre) lève la contrainte de poids qui bloquait
l'import de 100k+ POI en V1. Overture Maps est un dataset Apache 2.0 / ODbL,
maintenu par Meta + AWS + Microsoft + TomTom, dispo en Parquet sur S3 public.

Source : s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/
Lecture via DuckDB + httpfs (accès anonyme au bucket public, aucune clé AWS).
Le dataset est trié spatialement → un filtre bbox élague les fichiers Parquet
(footer stats) et rend la requête France rapide (~30 s sur tout le set).

──────────────────────────────────────────────────────────────────────────
Catégories Overture RÉELLES (vérifiées en live sur la release 2026-05-20.0,
slice France) — l'issue listait des noms supposés (`fitness_center`,
`dance_studio`, `spa`…) qui n'existent PAS tels quels dans Overture. On mappe
donc les catégories réelles, en EXACT match (un regex substring attrape des
faux positifs : « new**spa**per », « **spa**nish_restaurant »…).
──────────────────────────────────────────────────────────────────────────

Stratégie : un POI Overture = un venue. family_slug + primary_sport_slug
déduits de `categories.primary` via CATEGORY_MAP. source='overture',
external_id='overture/<overture_id>'.

Déduplication (mode live) : contre les venues existants du pays, match
(lat, lon) à ±50 m (grille ~0.0005°) + nom fuzzy ≥ 0.7 (difflib, stdlib).
Si match → SKIP (l'existant gagne, surtout les `claim_status='verified'`).

Idempotence : upsert ON CONFLICT (slug) ; relançable. Un venue claimed n'est
jamais écrasé (filtre `claim_status` côté chargement des existants).

Usage :
    pip install --break-system-packages duckdb supabase python-dotenv
    # Dry-run France fitness, 1000 POI (aucune écriture DB) :
    python3 scripts/import_overture.py --family fitness --country FR --limit 1000 --dry-run
    # Import réel France fitness, publié :
    python3 scripts/import_overture.py --family fitness --country FR --published true
    # Monde, non publié (revue manuelle ensuite) :
    python3 scripts/import_overture.py --family all --country WW --published false

Paliers recommandés (cf. workflow validé : vérifier live → petit → grand) :
    1. --country FR --family fitness --limit 1000 --dry-run   (valider mapping/counts)
    2. --country FR --family fitness --published true          (France d'abord)
    3. --country WW --family all     --published false         (monde, revue ensuite)
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Iterable

try:
    import duckdb
except ImportError:
    print("❌ pip install --break-system-packages duckdb", file=sys.stderr)
    sys.exit(1)

# ─── Constantes ──────────────────────────────────────────────────────────

# Dernière release vérifiée. Lister les releases dispo :
#   curl -s "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
DEFAULT_RELEASE = "2026-05-20.0"
S3_GLOB_TPL = (
    "s3://overturemaps-us-west-2/release/{release}"
    "/theme=places/type=place/*.parquet"
)

# Bbox grossière de la France métropolitaine (élague les fichiers Parquet).
FRANCE_BBOX = (-5.2, 41.0, 9.7, 51.5)  # (min_lon, min_lat, max_lon, max_lat)

# Seuil de confiance Overture : écarte les POI douteux (la confidence est la
# probabilité que le lieu existe réellement, agrégée multi-sources).
MIN_CONFIDENCE = 0.50

# Mapping catégorie Overture (EXACT) → (family_slug, primary_sport_slug).
# Vérifié en live (France) ; family/sport ∈ référentiels lib/families.ts.
# beauty_and_spa (≈42k FR) volontairement EXCLU : ce sont des salons de beauté
# (ongles/coiffure), hors-domaine sport/bien-être → pollue la famille.
CATEGORY_MAP: dict[str, tuple[str, str]] = {
    # ── Fitness ──
    "gym": ("fitness", "gym"),
    "crossfit_gym": ("fitness", "crossfit"),
    "pilates_studio": ("fitness", "pilates"),
    "gymnastics_center": ("fitness", "gym"),
    "fitness_trainer": ("fitness", "gym"),
    "sports_and_fitness_instruction": ("fitness", "gym"),
    "aerial_fitness_center": ("fitness", "gym"),
    "rock_climbing_gym": ("fitness", "gym"),
    "dance_school": ("fitness", "dance"),
    # ── Bien-être (family_slug = 'yoga', héritage V1) ──
    "yoga_studio": ("yoga", "yoga"),
    "yoga_instructor": ("yoga", "yoga"),
    "meditation_center": ("yoga", "meditation"),
    "spas": ("yoga", "spa"),
    "day_spa": ("yoga", "spa"),
    "health_spa": ("yoga", "spa"),
    "medical_spa": ("yoga", "spa"),
    "float_spa": ("yoga", "spa"),
    "thalasso": ("yoga", "spa"),
    "health_and_wellness_club": ("yoga", "spa"),
    "sauna": ("yoga", "sauna"),
    "hammam": ("yoga", "hammam"),
}

FAMILY_CATEGORIES: dict[str, list[str]] = {
    "fitness": [c for c, (f, _) in CATEGORY_MAP.items() if f == "fitness"],
    "yoga": [c for c, (f, _) in CATEGORY_MAP.items() if f == "yoga"],
}
FAMILY_CATEGORIES["all"] = list(CATEGORY_MAP.keys())

# Grille de dédup : ~0.0005° ≈ 55 m en latitude → cellule de proximité.
DEDUP_CELL = 0.0005
NAME_FUZZY_THRESHOLD = 0.70


# ─── Helpers purs (testables) ────────────────────────────────────────────


def slugify(s: str) -> str:
    """String → slug ASCII (même règle que scripts/import_v1.py)."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "untitled"


def venue_slug(name: str, locality: str | None, country: str | None) -> str:
    parts = [name or "spot"]
    if locality:
        parts.append(locality)
    if country:
        parts.append(country.lower())
    return slugify(" ".join(parts))[:120]


def name_similarity(a: str, b: str) -> float:
    """Ratio fuzzy normalisé [0,1] entre deux noms (insensible casse/accents)."""
    na = slugify(a).replace("-", " ")
    nb = slugify(b).replace("-", " ")
    return SequenceMatcher(None, na, nb).ratio()


def cell_key(lat: float, lon: float) -> tuple[int, int]:
    return (round(lat / DEDUP_CELL), round(lon / DEDUP_CELL))


@dataclass
class ExistingIndex:
    """Index spatial en mémoire (grille) des venues existants, pour la dédup."""

    # cellule → liste de (name, lat, lon)
    grid: dict[tuple[int, int], list[tuple[str, float, float]]] = field(
        default_factory=dict
    )

    def add(self, name: str, lat: float, lon: float) -> None:
        self.grid.setdefault(cell_key(lat, lon), []).append((name, lat, lon))

    def is_duplicate(self, name: str, lat: float, lon: float) -> bool:
        """Vrai si un venue existant est à ≤ ~50 m ET nom fuzzy ≥ seuil."""
        ck = cell_key(lat, lon)
        # On scanne la cellule + ses 8 voisines (un POI proche peut tomber dans
        # une cellule adjacente).
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ename, elat, elon in self.grid.get((ck[0] + dx, ck[1] + dy), ()):
                    # ~50 m : 0.00045° lat ; lon resserré par cos(lat) ignoré
                    # (approx suffisante à cette échelle).
                    if abs(elat - lat) <= 0.00045 and abs(elon - lon) <= 0.00060:
                        if name_similarity(ename, name) >= NAME_FUZZY_THRESHOLD:
                            return True
        return False


# ─── Requête Overture (DuckDB) ───────────────────────────────────────────


def build_overture_query(
    release: str, categories: list[str], country: str, limit: int | None
) -> str:
    cats_sql = ", ".join("'" + c.replace("'", "''") + "'" for c in categories)
    glob = S3_GLOB_TPL.format(release=release)
    where = [
        "categories.primary IS NOT NULL",
        f"categories.primary IN ({cats_sql})",
        "names.primary IS NOT NULL",
        f"confidence >= {MIN_CONFIDENCE}",
    ]
    if country == "FR":
        min_lon, min_lat, max_lon, max_lat = FRANCE_BBOX
        where.append(f"bbox.xmin BETWEEN {min_lon} AND {max_lon}")
        where.append(f"bbox.ymin BETWEEN {min_lat} AND {max_lat}")
        where.append("addresses[1].country = 'FR'")
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    return f"""
        SELECT
            id                       AS overture_id,
            names.primary            AS name,
            categories.primary       AS category,
            round(bbox.ymin, 6)      AS lat,
            round(bbox.xmin, 6)      AS lon,
            addresses[1].freeform    AS address,
            addresses[1].locality    AS locality,
            addresses[1].postcode    AS postcode,
            addresses[1].country     AS country_code,
            websites[1]              AS website,
            phones[1]                AS phone,
            confidence               AS confidence
        FROM read_parquet('{glob}')
        WHERE {" AND ".join(where)}
        {limit_sql}
    """


def connect_duckdb() -> "duckdb.DuckDBPyConnection":
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")  # bucket public, accès anonyme
    return con


# ─── Mapping POI → venue ─────────────────────────────────────────────────


def overture_row_to_venue(row: dict, published: bool) -> dict | None:
    cat = row["category"]
    mapping = CATEGORY_MAP.get(cat)
    if mapping is None:
        return None
    family_slug, sport_slug = mapping
    name = (row["name"] or "").strip()
    if not name or row["lat"] is None or row["lon"] is None:
        return None
    country_code = (row.get("country_code") or "").upper() or None
    return {
        "name": name,
        "slug": venue_slug(name, row.get("locality"), country_code),
        "lat": row["lat"],
        "lon": row["lon"],
        "family_slug": family_slug,
        "primary_sport_slug": sport_slug,
        "address": row.get("address"),
        "postal_code": row.get("postcode"),
        "country_code": country_code,
        "website_url": row.get("website"),
        "phone": row.get("phone"),
        "source": "overture",
        "external_id": f"overture/{row['overture_id']}",
        "is_published": published,
        "enrichments": {
            "overture_category": cat,
            "overture_confidence": row.get("confidence"),
        },
        "_sport_slug": sport_slug,  # interne, retiré avant upsert
    }


# ─── Pipeline ────────────────────────────────────────────────────────────


def run(args: argparse.Namespace) -> int:
    categories = FAMILY_CATEGORIES[args.family]
    print(
        f"▶ Overture {args.release} · family={args.family} · country={args.country} "
        f"· {len(categories)} catégories · published={args.published} · "
        f"{'DRY-RUN' if args.dry_run else 'LIVE'}"
    )

    con = connect_duckdb()
    query = build_overture_query(args.release, categories, args.country, args.limit)
    print("  ⏳ Requête Overture (DuckDB + httpfs)…")
    rows = [dict(zip([c[0] for c in con.description], r)) for r in con.execute(query).fetchall()]
    print(f"  ✓ {len(rows):,} POI Overture récupérés (avant mapping/dédup)")

    venues: list[dict] = []
    by_cat: dict[str, int] = {}
    for r in rows:
        v = overture_row_to_venue(r, published=args.published == "true")
        if v is None:
            continue
        venues.append(v)
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1

    print(f"  ✓ {len(venues):,} POI mappés en venues")
    for cat, n in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        fam, sport = CATEGORY_MAP[cat]
        print(f"      {n:7,}  {cat:32} → {fam}/{sport}")

    if args.dry_run:
        print("\n  🔎 DRY-RUN — échantillon (5 premiers) :")
        for v in venues[:5]:
            print(f"      {v['name'][:40]:40} {v['family_slug']}/{v['primary_sport_slug']:10} "
                  f"({v['lat']},{v['lon']}) {v['slug'][:50]}")
        print(f"\n  ℹ La dédup vs venues existants + l'upsert ne tournent qu'en mode live.")
        print(f"  ✅ DRY-RUN terminé : {len(venues):,} venues prêts à l'import.")
        return 0

    # ── Mode LIVE — import réel (nécessite les credentials Supabase) ──
    return _import_live(venues, country=args.country)


def _import_live(venues: list[dict], country: str) -> int:
    """Charge les existants, dédup, upsert. Import paresseux de supabase pour
    que le dry-run n'exige aucun credential."""
    import os
    from pathlib import Path

    try:
        from supabase import create_client
        from dotenv import load_dotenv
    except ImportError:
        print("❌ pip install --break-system-packages supabase python-dotenv", file=sys.stderr)
        return 1

    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
    load_dotenv()
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("❌ Définir NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)", file=sys.stderr)
        return 1
    sb = create_client(url, key)

    # Charge les venues existants (du pays si FR) pour la dédup. On ne charge
    # que id/name/lat/lon + claim_status (les claimed gagnent toujours).
    print("  ⏳ Chargement des venues existants pour la dédup…")
    index = ExistingIndex()
    existing_extids: set[str] = set()
    page, page_size = 0, 1000
    while True:
        q = sb.table("venue").select("name, lat, lon, external_id").is_("deleted_at", "null")
        if country == "FR":
            q = q.eq("country_code", "FR")
        chunk = q.range(page * page_size, page * page_size + page_size - 1).execute().data
        if not chunk:
            break
        for e in chunk:
            if e.get("lat") is not None and e.get("lon") is not None:
                index.add(e["name"] or "", e["lat"], e["lon"])
            if e.get("external_id"):
                existing_extids.add(e["external_id"])
        page += 1
    print(f"  ✓ {sum(len(v) for v in index.grid.values()):,} venues existants indexés")

    inserted = skipped_dup = skipped_extid = 0
    batch: list[dict] = []
    for v in venues:
        if v["external_id"] in existing_extids:
            skipped_extid += 1
            continue
        if index.is_duplicate(v["name"], v["lat"], v["lon"]):
            skipped_dup += 1
            continue
        sport_slug = v.pop("_sport_slug")
        batch.append({**v, "_sport_slug": sport_slug})
        if len(batch) >= 500:
            inserted += _flush(sb, batch)
            batch = []
    if batch:
        inserted += _flush(sb, batch)

    print(
        f"\n✅ Import terminé : {inserted:,} insérés · "
        f"{skipped_dup:,} skip (dédup proximité) · "
        f"{skipped_extid:,} skip (external_id déjà présent)"
    )
    return 0


def _flush(sb, batch: list[dict]) -> int:
    """Upsert un lot de venues + leur venue_sport. Retourne le nb upserté."""
    sport_by_extid = {v["external_id"]: v.pop("_sport_slug") for v in batch}
    res = sb.table("venue").upsert(
        batch, on_conflict="slug", returning="representation"
    ).execute()
    vs_rows = []
    for v in res.data:
        sport = sport_by_extid.get(v["external_id"])
        if sport:
            vs_rows.append({"venue_id": v["id"], "sport_slug": sport, "is_primary": True})
    if vs_rows:
        sb.table("venue_sport").upsert(vs_rows, on_conflict="venue_id,sport_slug").execute()
    return len(res.data)


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Import Overture Maps places → Supabase (#110)")
    p.add_argument("--family", choices=["fitness", "yoga", "all"], default="fitness")
    p.add_argument("--country", choices=["FR", "WW"], default="FR")
    p.add_argument("--limit", type=int, default=None, help="Cap le nb de POI (test)")
    p.add_argument("--published", choices=["true", "false"], default="false",
                   help="is_published des venues insérés (FR=true, WW=false conseillé)")
    p.add_argument("--release", default=DEFAULT_RELEASE, help="Release Overture")
    p.add_argument("--dry-run", action="store_true",
                   help="Aucune écriture DB : requête + mapping + report seulement")
    args = p.parse_args(list(argv) if argv is not None else None)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
