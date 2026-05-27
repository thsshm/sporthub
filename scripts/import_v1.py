#!/usr/bin/env python3
"""
import_v1.py — Migration des données SportHub V1 (SQLite) → Supabase (Postgres).

Lit ../data-pipeline/data/sportpin.sqlite et populate Supabase avec :
  - country (5 pays seedés en migration 0001, on s'assure que tous les pays
    présents dans la data sont créés)
  - city (déduit depuis spots.city + postal_code + lat/lon moyens)
  - venue (un spot ou un club = un venue selon stratégie)
  - venue_sport (sports d'un venue, basé sur clubs.sports JSON)
  - venue_amenity (basé sur les features OSM/RES présentes dans raw_tags)
  - booking_link (vide pour l'instant — à enrichir Phase 3)

Stratégie d'import — DEUX MODES :
  --mode=spots-only : 1 venue par spot V1 (267k venues, granularité fine)
  --mode=clubs-only : 1 venue par club V1 (63k venues clusterisés, recommandé)
  --mode=mixed      : clubs quand club_id présent, spots orphelins sinon

Recommandation : --mode=clubs-only pour la V2 (déduplication propre).

Idempotent : utilise ON CONFLICT (slug) DO UPDATE → peut être relancé.

Usage :
  # Préparer .env avec :
  #   SUPABASE_URL=https://xxx.supabase.co
  #   SUPABASE_SERVICE_ROLE_KEY=eyJ...    (PAS la anon key — server-only)
  #   V1_SQLITE_PATH=../data-pipeline/data/sportpin.sqlite
  pip install --break-system-packages supabase python-dotenv slugify
  python3 scripts/import_v1.py --mode=clubs-only --limit 1000  # test
  python3 scripts/import_v1.py --mode=clubs-only               # full
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path
from typing import Iterator

try:
    from supabase import create_client, Client
except ImportError:
    print("❌ pip install --break-system-packages supabase python-dotenv slugify")
    sys.exit(1)

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
V1_DB = os.getenv("V1_SQLITE_PATH", "../data-pipeline/data/sportpin.sqlite")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ Définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env")
    sys.exit(1)

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ─── Helpers ─────────────────────────────────────────────────────────────


def slugify(s: str) -> str:
    """Convertit n'importe quelle string en slug ASCII (idem package slugify)."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "untitled"


def venue_slug(name: str, city: str | None, country: str | None) -> str:
    """Slug stable pour un venue : nom + ville + pays."""
    parts = [name or "spot"]
    if city:
        parts.append(city)
    if country:
        parts.append(country.lower())
    return slugify(" ".join(parts))[:120]


def safe_json(s: str | None) -> dict | list | None:
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def chunked(iterable, n: int) -> Iterator[list]:
    """Yield successifs de batches de taille n."""
    buf = []
    for x in iterable:
        buf.append(x)
        if len(buf) >= n:
            yield buf
            buf = []
    if buf:
        yield buf


# ─── Steps ───────────────────────────────────────────────────────────────


def ensure_countries(conn: sqlite3.Connection) -> set[str]:
    """Assure que tous les pays présents dans les spots existent dans Supabase."""
    cur = conn.execute(
        "SELECT DISTINCT country FROM spots WHERE country IS NOT NULL AND country != ''"
    )
    codes = sorted({r[0].upper() for r in cur if len(r[0]) == 2})

    # Pays déjà dans Supabase (depuis seed migration 0001)
    existing = {
        r["code"] for r in sb.table("country").select("code").execute().data
    }

    # Insère les manquants avec un nom basique (sera amélioré manuellement)
    new = [c for c in codes if c not in existing]
    if new:
        rows = [
            {"code": c, "name_fr": c, "name_en": c, "emoji_flag": ""}
            for c in new
        ]
        sb.table("country").upsert(rows).execute()
        print(f"  ✓ {len(new)} pays ajoutés : {', '.join(new[:10])}…")
    return set(codes) | existing


def build_cities(conn: sqlite3.Connection, valid_countries: set[str]) -> dict:
    """Crée les villes depuis les spots. Retourne dict (country, slug) → city_id."""
    print("🏙  Extraction des villes depuis les spots…")
    # On groupe par (country, city) et calcule lat/lon moyens
    cur = conn.execute("""
        SELECT country, city,
               AVG(lat) lat, AVG(lon) lon,
               COUNT(*) n_spots
        FROM spots
        WHERE city IS NOT NULL AND city != ''
          AND country IS NOT NULL AND country != ''
          AND lat IS NOT NULL AND lon IS NOT NULL
        GROUP BY country, city
        HAVING n_spots >= 3   -- au moins 3 spots pour considérer la ville
    """)
    cities = []
    for r in cur:
        country = r["country"].upper()
        if country not in valid_countries:
            continue
        city_name = r["city"].strip()
        cities.append({
            "slug": slugify(city_name),
            "name": city_name,
            "country_code": country,
            "lat": r["lat"],
            "lon": r["lon"],
            "is_featured": r["n_spots"] >= 100,  # villes avec ≥100 spots = featured
        })
    print(f"  → {len(cities):,} villes uniques détectées")

    # Upsert par batch
    city_index = {}
    for batch in chunked(cities, 500):
        result = sb.table("city").upsert(
            batch,
            on_conflict="country_code,slug",
            returning="representation",
        ).execute()
        for row in result.data:
            city_index[(row["country_code"], row["slug"])] = row["id"]
    print(f"  ✓ {len(city_index):,} villes en DB")
    return city_index


def yield_venues_from_clubs(conn: sqlite3.Connection, city_index: dict, limit: int | None):
    """Itère sur la table clubs (recommandé : 63k venues clusterisés, propre)."""
    sql = """
        SELECT c.id, c.club_id, c.family, c.name, c.lat, c.lon,
               c.city, c.country, c.postal_code, c.address,
               c.courts_count, c.sports, c.surfaces, c.features,
               c.operator, c.brand, c.website, c.phone, c.sources
        FROM clubs c
        WHERE c.lat IS NOT NULL AND c.lon IS NOT NULL
          AND c.name IS NOT NULL AND c.name != ''
    """
    if limit:
        sql += f" LIMIT {limit}"
    for r in conn.execute(sql):
        country = (r["country"] or "FR").upper()
        city_id = city_index.get((country, slugify(r["city"] or "")))
        sports = safe_json(r["sports"]) or []
        surfaces = safe_json(r["surfaces"]) or []
        features = safe_json(r["features"]) or {}
        sources = safe_json(r["sources"]) or []

        venue = {
            "slug": f"{slugify(r['name'])}-{r['club_id'][:30]}",  # garantie unique
            "name": r["name"],
            "lat": r["lat"],
            "lon": r["lon"],
            "address": r["address"],
            "city_id": city_id,
            "postal_code": r["postal_code"],
            "country_code": country if len(country) == 2 else None,
            "website_url": r["website"],
            "phone": r["phone"],
            "family_slug": r["family"],
            "primary_sport_slug": sports[0] if sports else None,
            "courts_count": r["courts_count"],
            "is_indoor": features.get("indoor") or features.get("covered"),
            "has_lighting": features.get("lit"),
            "is_wheelchair_accessible": features.get("wheelchair"),
            "source": sources[0] if sources else "v1-import",
            "external_id": r["club_id"],
            "enrichments": {
                "v1_club_id": r["club_id"],
                "surfaces": surfaces,
                "features": features,
                "operator": r["operator"],
                "brand": r["brand"],
            },
        }
        yield venue, sports, features


def import_venues(conn: sqlite3.Connection, city_index: dict, mode: str, limit: int | None):
    """Insère les venues + venue_sport + venue_amenity."""
    print(f"\n🏟  Import venues (mode={mode}, limit={limit or 'all'})")
    if mode != "clubs-only":
        print(f"  ⚠ mode '{mode}' pas encore implémenté — utilise clubs-only")
        return

    # Cache slug → id pour pouvoir lier venue_sport
    venue_ids_by_extid = {}
    total = 0
    for batch in chunked(yield_venues_from_clubs(conn, city_index, limit), 200):
        rows = [v for v, _, _ in batch]
        result = sb.table("venue").upsert(
            rows, on_conflict="slug", returning="representation"
        ).execute()
        for inserted in result.data:
            venue_ids_by_extid[inserted["external_id"]] = inserted["id"]

        # Insère les venue_sport
        vs_rows = []
        for v, sports, _ in batch:
            vid = venue_ids_by_extid.get(v["external_id"])
            if not vid or not sports:
                continue
            for idx, sport_slug in enumerate(sports):
                vs_rows.append({
                    "venue_id": vid,
                    "sport_slug": sport_slug,
                    "is_primary": idx == 0,
                })
        if vs_rows:
            sb.table("venue_sport").upsert(
                vs_rows, on_conflict="venue_id,sport_slug"
            ).execute()

        # Insère les venue_amenity (basé sur features dict)
        va_rows = []
        for v, _, features in batch:
            vid = venue_ids_by_extid.get(v["external_id"])
            if not vid or not features:
                continue
            mapping = {
                "shower": "shower",
                "changing_room": "changing_room",
                "parking": "parking",
                "reservation": "reservation",
                "bar": "bar",
                "restaurant": "restaurant",
                "ac": "ac",
                "heated": "heated",
                "sauna": "sauna",
            }
            for feat_key, amenity_slug in mapping.items():
                if features.get(feat_key):
                    va_rows.append({"venue_id": vid, "amenity_slug": amenity_slug})
        if va_rows:
            sb.table("venue_amenity").upsert(
                va_rows, on_conflict="venue_id,amenity_slug"
            ).execute()

        total += len(rows)
        print(f"  ... {total:,} venues importés")

    print(f"\n✅ {total:,} venues importés (+ venue_sport + venue_amenity)")


# ─── Main ────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", default="clubs-only",
                        choices=["clubs-only", "spots-only", "mixed"])
    parser.add_argument("--limit", type=int, default=None,
                        help="Limite nb venues (utile pour tests)")
    args = parser.parse_args()

    db_path = Path(V1_DB).expanduser().resolve()
    if not db_path.exists():
        print(f"❌ SQLite introuvable : {db_path}")
        return 1
    print(f"📂 Lecture V1 : {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Step 1: pays
    print("\n🌍 Étape 1/3 : pays")
    valid_countries = ensure_countries(conn)

    # Step 2: villes
    print("\n🏙  Étape 2/3 : villes")
    city_index = build_cities(conn, valid_countries)

    # Step 3: venues + venue_sport + venue_amenity
    print("\n🏟  Étape 3/3 : venues + sports + amenities")
    import_venues(conn, city_index, args.mode, args.limit)

    print("\n🎉 Import terminé. Vérifie dans Supabase Studio.")
    print("   Prochaine étape : appliquer migration 0003_postgis.sql")
    return 0


if __name__ == "__main__":
    sys.exit(main())
