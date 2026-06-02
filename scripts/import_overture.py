#!/usr/bin/env python3
"""
import_overture.py — Import Overture Maps « places » → Supabase.

Familles couvertes : Fitness + Bien-être (#110), Snow + Retraites (#97),
                     Raquette + Ballon (#227, ingestion V2-native).

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

Snow (#97) : la bbox FR ne couvre que les Alpes françaises + Pyrénées. Pour le
massif alpin complet (CH/AT/IT), lancer --country WW :
    python3 scripts/import_overture.py --family snow --country FR --published true
    python3 scripts/import_overture.py --family snow --country WW --published false
Retraites (#97) : couverture Overture quasi-nulle (~4 health_retreats FR) — la
densité réelle exige une source dédiée (retreatguru / bookyogaretreats), hors
scope Overture ; cette famille reste à compléter par un scraper spécifique.
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

import time as _time

# Retry sur erreurs transitoires côté prod (statement_timeout Postgres 57014 +
# erreurs réseau httpx) — l'import charge ~370k venues existants pour la dédup
# et la prod peut être lente/sous charge. httpx/postgrest sont des deps de
# supabase (présents en mode live ; le dry-run n'atteint pas _safe).
try:
    import httpx as _httpx
    from postgrest.exceptions import APIError as _APIError
    _TRANSIENT = (_httpx.RemoteProtocolError, _httpx.ReadError, _httpx.ReadTimeout,
                  _httpx.ConnectError, _httpx.ConnectTimeout, _httpx.WriteError,
                  _httpx.PoolTimeout)
except ImportError:
    _APIError = Exception
    _TRANSIENT = ()


def _safe(build, tries=7):
    """Exécute build() avec retry exponentiel sur 57014 + erreurs httpx."""
    last = None
    for i in range(tries):
        try:
            return build()
        except _APIError as e:
            last = e
            if getattr(e, "code", "") != "57014":
                raise
            w = min(2 ** i, 30)
            print(f"  ⚠ 57014 timeout → retry {i+1}/{tries} dans {w}s", file=sys.stderr, flush=True)
            _time.sleep(w)
        except _TRANSIENT as e:
            last = e
            w = min(2 ** i, 30)
            print(f"  ⚠ {type(e).__name__} → retry {i+1}/{tries} dans {w}s", file=sys.stderr, flush=True)
            _time.sleep(w)
    raise last

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
    # ── Snow / sports d'hiver (issue #97 : 0 venue en base) ──
    # Vérifié en live (France) : ski_resort 3243, ski_and_snowboard_school 705,
    # ski_area 4, mountain_huts 41. Les pièges « ski » substring (skin_care,
    # skilled_nursing) sont écartés par construction (exact match, absents du map).
    "ski_resort": ("snow", "skiing"),
    "ski_area": ("snow", "skiing"),
    "ski_and_snowboard_school": ("snow", "skiing"),
    "mountain_huts": ("snow", "skiing"),  # refuges d'altitude → base ski touring
    # ── Retraites & camps (issue #97) ──
    # Couverture Overture TRÈS faible (health_retreats ≈ 4 en FR). On importe le
    # peu qui existe (surtout en WW) mais la vraie densité « retraites » exige une
    # source dédiée (retraites yoga/surf : retreatguru, bookyogaretreats…) — cf.
    # note PR : hors-scope Overture.
    "health_retreats": ("retraites", "wellness_retreat"),
    # ── Raquette (#227 : ingestion V2-native, réduit la dépendance SQLite V1) ──
    # Vérifié en live (France) : tennis_court 6849, badminton_court 375,
    # squash_court 192, table_tennis_club 139, racquetball_court 76,
    # tennis_stadium 215, paddle_tennis_club 2. Les pièges « court » substring
    # (courthouse 2176, food_court 225) sont écartés par construction (exact).
    "tennis_court": ("raquette", "tennis"),
    "tennis_stadium": ("raquette", "tennis"),
    "paddle_tennis_club": ("raquette", "padel"),
    "badminton_court": ("raquette", "badminton"),
    "squash_court": ("raquette", "squash"),
    "racquetball_court": ("raquette", "squash"),  # racquetball ≈ squash (pas de slug dédié)
    "table_tennis_club": ("raquette", "table_tennis"),
    # ── Ballon (#227) ──
    # Vérifié en live (France) : soccer_field 3512, basketball_court 446,
    # rugby_pitch 413, volleyball_court 236, soccer/football_stadium ≈1700.
    # On EXCLUT sports_club_and_league (39740) et stadium_arena (12598) :
    # trop génériques (sport indéterminé) → pollueraient la famille.
    "soccer_field": ("ballon", "football"),
    "soccer_stadium": ("ballon", "football"),
    "soccer_club": ("ballon", "football"),
    "football_stadium": ("ballon", "football"),
    "football_club": ("ballon", "football"),
    "basketball_court": ("ballon", "basketball"),
    "basketball_stadium": ("ballon", "basketball"),
    "volleyball_court": ("ballon", "volleyball"),
    "volleyball_club": ("ballon", "volleyball"),
    "beach_volleyball_court": ("ballon", "volleyball"),
    "rugby_pitch": ("ballon", "rugby"),
    "rugby_stadium": ("ballon", "rugby"),
    # ── Combat (#227) — vérifié FR : martial_arts_club 14966, boxing_class
    # 1383, karate_club 76, boxing_gym 61, kickboxing_club 36. ──
    "martial_arts_club": ("combat", "mma"),  # générique → mma (arts martiaux mixtes)
    "karate_club": ("combat", "karate"),
    "boxing_class": ("combat", "boxing"),
    "boxing_gym": ("combat", "boxing"),
    "kickboxing_club": ("combat", "boxing"),
    # ── Baignade (#227) — vérifié FR : beach 12709, swimming_pool 8433,
    # swimming_instructor 865. Pièges « pool » substring (pool_billiards 839,
    # pool_hall 238, pool_cleaning 3461, hot_tubs_and_pools) écartés (exact). ──
    "beach": ("baignade", "beach"),
    "swimming_pool": ("baignade", "pool"),
    "swimming_instructor": ("baignade", "pool"),
    # ── Glisse (#227) — vérifié FR : surfing 420, kiteboarding 158. Retail
    # (surf_shop 833, skate_shop) et skate_park (pas de slug skate) exclus. ──
    "surfing": ("glisse", "surf"),
    "kiteboarding": ("glisse", "kitesurf"),
    # ── Nautique (#227) — vérifié FR : marina 1359, sailing_club 96. ──
    "marina": ("nautique", "marina"),
    "sailing_club": ("nautique", "marina"),
    # ── Hike / plein air (#227) — vérifié FR : hiking_trail 3461,
    # mountain_bike_trails 345. ──
    "hiking_trail": ("hike", "trail"),
    "mountain_bike_trails": ("hike", "mtb"),
    # ── Plus (#227) — vérifié FR : equestrian_facility 6772, golf_course 3007,
    # horse_riding 2412, golf_club 128, rock_climbing_gym 114. Exclus : golf_
    # instructor/equipment/cart_dealer, miniature_golf_course, horse_boarding. ──
    "golf_course": ("plus", "golf"),
    "golf_club": ("plus", "golf"),
    "equestrian_facility": ("plus", "equestrian"),
    "horse_riding": ("plus", "equestrian"),
    "rock_climbing_gym": ("plus", "climbing_indoor"),
    # ── Boules : aucune couverture Overture (pétanque/bocce absents) → source
    # dédiée nécessaire (OSM sport=boules), hors scope Overture. ──
}

FAMILY_CATEGORIES: dict[str, list[str]] = {
    "fitness": [c for c, (f, _) in CATEGORY_MAP.items() if f == "fitness"],
    "yoga": [c for c, (f, _) in CATEGORY_MAP.items() if f == "yoga"],
    "snow": [c for c, (f, _) in CATEGORY_MAP.items() if f == "snow"],
    "retraites": [c for c, (f, _) in CATEGORY_MAP.items() if f == "retraites"],
    "raquette": [c for c, (f, _) in CATEGORY_MAP.items() if f == "raquette"],
    "ballon": [c for c, (f, _) in CATEGORY_MAP.items() if f == "ballon"],
    "combat": [c for c, (f, _) in CATEGORY_MAP.items() if f == "combat"],
    "baignade": [c for c, (f, _) in CATEGORY_MAP.items() if f == "baignade"],
    "glisse": [c for c, (f, _) in CATEGORY_MAP.items() if f == "glisse"],
    "nautique": [c for c, (f, _) in CATEGORY_MAP.items() if f == "nautique"],
    "hike": [c for c, (f, _) in CATEGORY_MAP.items() if f == "hike"],
    "plus": [c for c, (f, _) in CATEGORY_MAP.items() if f == "plus"],
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
    # Timeout PostgREST 120s (httpx court par défaut → ReadError sur page lente).
    # Cf. backfill_courts_count.py (#274).
    try:
        sb.postgrest.session.timeout = 120
    except Exception:
        pass

    # Charge les venues existants (du pays si FR) pour la dédup. KEYSET
    # pagination (id > last_id) au lieu d'OFFSET : sur ~370k venues l'OFFSET
    # profond cause des statement-timeout Postgres (57014). Cf. #274 / #223.
    print("  ⏳ Chargement des venues existants pour la dédup…")
    index = ExistingIndex()
    existing_extids: set[str] = set()
    last_id, page_size, loaded = "", 1000, 0
    while True:
        q = (sb.table("venue").select("id, name, lat, lon, external_id")
             .is_("deleted_at", "null").order("id").limit(page_size))
        if country == "FR":
            q = q.eq("country_code", "FR")
        if last_id:
            q = q.gt("id", last_id)
        chunk = _safe(lambda q=q: q.execute()).data or []
        if not chunk:
            break
        for e in chunk:
            if e.get("lat") is not None and e.get("lon") is not None:
                index.add(e["name"] or "", e["lat"], e["lon"])
            if e.get("external_id"):
                existing_extids.add(e["external_id"])
        last_id = chunk[-1]["id"]
        loaded += len(chunk)
        if loaded % 20000 < page_size:
            print(f"    … {loaded:,} existants chargés", flush=True)
    print(f"  ✓ {sum(len(v) for v in index.grid.values()):,} venues existants indexés")

    inserted = skipped_dup = skipped_extid = skipped_slug = 0
    seen_slugs: set[str] = set()
    batch: list[dict] = []
    for v in venues:
        if v["external_id"] in existing_extids:
            skipped_extid += 1
            continue
        # Dédup intra-run par slug : deux POI Overture peuvent générer le même
        # slug (ex. deux « La Pierre Saint-Martin ») → l'upsert on_conflict=slug
        # casse (APIError 21000 : "ON CONFLICT DO UPDATE cannot affect row a
        # second time") si le lot contient 2× le même slug. On garde la 1re.
        if v["slug"] in seen_slugs:
            skipped_slug += 1
            continue
        if index.is_duplicate(v["name"], v["lat"], v["lon"]):
            skipped_dup += 1
            continue
        seen_slugs.add(v["slug"])
        sport_slug = v.pop("_sport_slug")
        batch.append({**v, "_sport_slug": sport_slug})
        # Lots de 100 (pas 500) : l'upsert venue avec returning=representation +
        # trigger geom PostGIS dépasse le statement_timeout serveur au-delà.
        if len(batch) >= 100:
            inserted += _flush(sb, batch)
            batch = []
    if batch:
        inserted += _flush(sb, batch)

    print(
        f"\n✅ Import terminé : {inserted:,} insérés · "
        f"{skipped_dup:,} skip (dédup proximité) · "
        f"{skipped_slug:,} skip (slug dupliqué intra-run) · "
        f"{skipped_extid:,} skip (external_id déjà présent)"
    )
    return 0


def _flush(sb, batch: list[dict]) -> int:
    """Upsert un lot de venues + leur venue_sport. Retourne le nb upserté."""
    sport_by_extid = {v["external_id"]: v.pop("_sport_slug") for v in batch}
    res = _safe(lambda: sb.table("venue").upsert(
        batch, on_conflict="slug", returning="representation"
    ).execute())
    vs_rows = []
    for v in res.data:
        sport = sport_by_extid.get(v["external_id"])
        if sport:
            vs_rows.append({"venue_id": v["id"], "sport_slug": sport, "is_primary": True})
    if vs_rows:
        _safe(lambda: sb.table("venue_sport").upsert(vs_rows, on_conflict="venue_id,sport_slug").execute())
    return len(res.data)


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Import Overture Maps places → Supabase (#110 fitness/yoga, #97 snow/retraites)")
    p.add_argument(
        "--family",
        choices=[
            "fitness", "yoga", "snow", "retraites", "raquette", "ballon",
            "combat", "baignade", "glisse", "nautique", "hike", "plus", "all",
        ],
        default="fitness",
    )
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
