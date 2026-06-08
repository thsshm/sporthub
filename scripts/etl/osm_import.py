#!/usr/bin/env python3
"""
etl/osm_import.py — Importeur OSM Overpass → Supabase (#227, tranche 227.2).

Requête Overpass pour une famille/région → mapping → upsert idempotent via
scripts/etl_upsert.py (source='osm', external_id='osm/<type>/<id>').
Un `import_run` est créé en début de run et mis à jour en fin.

Familles supportées et leurs tags OSM :
  - raquette  : sport=tennis | sport=padel | sport=table_tennis |
                sport=badminton | sport=squash | leisure=sports_centre (sport=tennis)
  - fitness   : leisure=fitness_centre | leisure=sports_centre (sport=fitness)
  - combat    : sport=judo | sport=karate | sport=boxing | sport=martial_arts
  - baignade  : leisure=swimming_pool (access!=private) | sport=swimming
  - boules    : sport=boules | sport=petanque
  - hike      : route=hiking (type=route) — limité, optionnel
  - escalade  : sport=climbing

Périmètre géographique via bbox ISO-alpha2 (prédéfini) ou bbox manuelle.

Usage :
    python3 scripts/etl/osm_import.py --family raquette --country FR --dry-run
    python3 scripts/etl/osm_import.py --family raquette --country FR
    python3 scripts/etl/osm_import.py --family all --country FR --dry-run

Options :
    --family    raquette|fitness|combat|yoga|baignade|boules|nautique|glisse|snow|hike|escalade|ballon|plus|all
    --country   ISO-2 (FR, ES, DE, IT, PT, BE, NL, CH, …) ou "EU" (bbox Europe)
    --limit     Cap le nb de venues (test/smoke)
    --dry-run   N'écrit pas en DB (défaut : False)
    --chunk     Taille des lots upsert (défaut : 100)
    --self-test Tests de la logique pure (sans réseau)

Dépendances : stdlib Python uniquement. Conforme à la règle "deps-free".
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import json
from pathlib import Path
from typing import Iterator

# Ajoute la racine du repo au path pour importer etl_upsert depuis scripts/
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))
from etl_upsert import (  # noqa: E402
    SupabaseRestClient,
    UpsertResult,
    VenueRecord,
    open_import_run,
    close_import_run,
    upsert_venues_batch,
    soft_delete_missing,
)
from cleaning import is_misclassified  # noqa: E402  (sibling, scripts/etl sur sys.path)

# ── Constantes ────────────────────────────────────────────────────────────────

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "SportHubMap/1.0 (gautier.no@gmail.com) https://sporthubmap.com"
SOURCE = "osm"

# Bounding boxes par pays/région (S, W, N, E)
COUNTRY_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "FR": (41.3, -5.1, 51.1, 9.6),
    "ES": (35.9, -9.3, 43.8, 4.3),
    "DE": (47.3, 5.9, 55.0, 15.0),
    "IT": (36.6, 6.7, 47.1, 18.5),
    "PT": (36.9, -9.5, 42.1, -6.2),
    "BE": (49.5, 2.5, 51.5, 6.4),
    "NL": (50.8, 3.3, 53.5, 7.1),
    "CH": (45.8, 5.9, 47.8, 10.5),
    "AT": (46.4, 9.5, 49.0, 17.2),
    "GB": (49.9, -8.2, 60.9, 1.8),
    "EU": (34.0, -25.0, 72.0, 45.0),
}

# Tags OSM → (family_slug, primary_sport_slug)
# Couvre toutes les 14 familles V2 avec les tags OSM les plus répandus.
# Sources de référence : taginfo.openstreetmap.org + mapping V1.
TAG_MAP: dict[tuple[str, str], tuple[str, str]] = {
    # Raquette
    ("sport", "tennis"):       ("raquette", "tennis"),
    ("sport", "padel"):        ("raquette", "padel"),
    ("sport", "table_tennis"): ("raquette", "table_tennis"),
    ("sport", "badminton"):    ("raquette", "badminton"),
    ("sport", "squash"):       ("raquette", "squash"),
    # Fitness
    ("leisure", "fitness_centre"): ("fitness", "gym"),
    ("sport", "crossfit"):     ("fitness", "crossfit"),
    ("sport", "pilates"):      ("fitness", "pilates"),
    ("leisure", "dance"):      ("fitness", "dance"),
    # Combat
    ("sport", "judo"):         ("combat", "judo"),
    ("sport", "karate"):       ("combat", "karate"),
    ("sport", "boxing"):       ("combat", "boxing"),
    ("sport", "martial_arts"): ("combat", "combat"),
    # Bien-être / yoga
    ("sport", "yoga"):         ("yoga", "yoga"),
    ("leisure", "spa"):        ("yoga", "spa"),
    ("amenity", "spa"):        ("yoga", "spa"),
    # Baignade
    ("leisure", "swimming_pool"): ("baignade", "pool"),
    ("sport", "swimming"):     ("baignade", "pool"),
    ("natural", "beach"):      ("baignade", "beach"),
    # Boules
    ("sport", "boules"):       ("boules", "boules"),
    ("sport", "petanque"):     ("boules", "petanque"),
    # Nautique
    ("sport", "surfing"):      ("nautique", "surf"),
    ("sport", "kitesurfing"):  ("nautique", "kitesurf"),
    ("sport", "windsurfing"):  ("nautique", "windsurf"),
    ("sport", "diving"):       ("nautique", "diving"),
    ("sport", "scuba_diving"): ("nautique", "diving"),
    ("amenity", "dive_centre"):("nautique", "diving"),
    ("leisure", "marina"):     ("nautique", "marina"),
    # Glisse / board sports
    ("sport", "skateboard"):   ("glisse", "glisse"),
    ("leisure", "skateboard_park"): ("glisse", "glisse"),
    ("sport", "bmx"):          ("glisse", "glisse"),
    # Snow / hiver
    ("sport", "skiing"):       ("snow", "skiing"),
    ("sport", "snowboarding"): ("snow", "snowboarding"),
    ("aerialway", "chair_lift"):("snow", "skiing"),  # remontées mécaniques
    # Plein air / hike
    ("highway", "trailhead"):  ("hike", "trail"),
    ("route", "hiking"):       ("hike", "trail"),
    ("sport", "cycling"):      ("hike", "cycling"),
    ("sport", "running"):      ("hike", "running"),
    ("sport", "athletics"):    ("hike", "running"),
    # Escalade
    ("sport", "climbing"):     ("escalade", "climbing_indoor"),
    ("natural", "rock"):       ("escalade", "climbing_indoor"),  # falaises
    # Ballon
    ("sport", "football"):     ("ballon", "football"),
    ("sport", "soccer"):       ("ballon", "football"),
    ("sport", "basketball"):   ("ballon", "basketball"),
    ("sport", "handball"):     ("ballon", "handball"),
    ("sport", "volleyball"):   ("ballon", "volleyball"),
    ("sport", "rugby"):        ("ballon", "rugby"),
    # Golf (→ plus)
    ("leisure", "golf_course"):("plus", "golf"),
    ("sport", "golf"):         ("plus", "golf"),
    # Équitation (→ plus)
    ("leisure", "horse_riding"):("plus", "equestrian"),
    ("sport", "equestrian"):   ("plus", "equestrian"),
    # Tir à l'arc (→ plus)
    ("sport", "archery"):      ("plus", "archery"),
    # Parapente (→ plus)
    ("sport", "paragliding"):  ("plus", "paragliding"),
}

# Tags par famille pour construire les requêtes Overpass.
# On regroupe par famille pour limiter le nb de requêtes Overpass.
FAMILY_TAGS: dict[str, list[tuple[str, str]]] = {
    "raquette":  [("sport", "tennis"), ("sport", "padel"), ("sport", "table_tennis"),
                  ("sport", "badminton"), ("sport", "squash")],
    "fitness":   [("leisure", "fitness_centre"), ("sport", "crossfit"),
                  ("sport", "pilates"), ("leisure", "dance")],
    "combat":    [("sport", "judo"), ("sport", "karate"), ("sport", "boxing"),
                  ("sport", "martial_arts")],
    "yoga":      [("sport", "yoga"), ("leisure", "spa"), ("amenity", "spa")],
    "baignade":  [("leisure", "swimming_pool"), ("sport", "swimming"),
                  ("natural", "beach")],
    "boules":    [("sport", "boules"), ("sport", "petanque")],
    "nautique":  [("sport", "surfing"), ("sport", "kitesurfing"),
                  ("sport", "windsurfing"), ("sport", "diving"),
                  ("amenity", "dive_centre"), ("leisure", "marina")],
    "glisse":    [("sport", "skateboard"), ("leisure", "skateboard_park"),
                  ("sport", "bmx")],
    "snow":      [("sport", "skiing"), ("sport", "snowboarding"),
                  ("aerialway", "chair_lift")],
    "hike":      [("highway", "trailhead"), ("sport", "cycling"),
                  ("sport", "running"), ("sport", "athletics")],
    "escalade":  [("sport", "climbing"), ("natural", "rock")],
    "ballon":    [("sport", "football"), ("sport", "soccer"),
                  ("sport", "basketball"), ("sport", "handball"),
                  ("sport", "volleyball"), ("sport", "rugby")],
    "plus":      [("leisure", "golf_course"), ("sport", "golf"),
                  ("sport", "equestrian"), ("leisure", "horse_riding"),
                  ("sport", "archery"), ("sport", "paragliding")],
}


# ── Overpass query builder ─────────────────────────────────────────────────────

def build_overpass_query(
    tag_key: str,
    tag_value: str,
    bbox: tuple[float, float, float, float],
    timeout: int = 60,
) -> str:
    """Requête Overpass pour (node|way)[tag_key=tag_value] dans bbox.
    Retourne les géométries centrées (out center) + tags.
    bbox = (S, W, N, E) comme Overpass l'attend.
    """
    s, w, n, e = bbox
    bbox_str = f"{s},{w},{n},{e}"
    return (
        f"[out:json][timeout:{timeout}];"
        f'(node["{tag_key}"="{tag_value}"]({bbox_str});'
        f'way["{tag_key}"="{tag_value}"]({bbox_str}););'
        f"out center tags;"
    )


# ── Overpass fetch ─────────────────────────────────────────────────────────────

def fetch_overpass(query: str, retries: int = 3) -> list[dict]:
    """Requête Overpass avec retry (rate-limit 429 → backoff 60s)."""
    data = urllib.parse.urlencode({"data": query}).encode()
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                OVERPASS_URL,
                data=data,
                headers={
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
                return payload.get("elements", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 60 * (attempt + 1)
                print(f"    ⏳ rate-limit Overpass — attente {wait}s …", flush=True)
                time.sleep(wait)
                last_exc = e
            else:
                raise
        except Exception as e:  # noqa: BLE001
            last_exc = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass échec après {retries} tentatives") from last_exc


# ── Mapping Overpass → VenueRecord ────────────────────────────────────────────

def element_to_record(
    el: dict,
    family_slug: str,
    sport_slug: str,
) -> VenueRecord | None:
    """Convertit un élément Overpass en VenueRecord.
    Retourne None si l'élément est inutilisable (pas de coords, pas de nom utile).
    """
    tags: dict[str, str] = el.get("tags") or {}
    el_type = el.get("type")  # node | way
    el_id = el.get("id")
    if not el_type or el_id is None:
        return None

    # Coordonnées
    if el_type == "node":
        lat, lon = el.get("lat"), el.get("lon")
    else:
        center = el.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")

    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    # Nom
    name = (
        tags.get("name")
        or tags.get("operator")
        or tags.get("brand")
        or ""
    ).strip()
    if not name:
        return None  # on n'importe pas les lieux sans nom

    external_id = f"osm/{el_type}/{el_id}"
    address_parts = [
        tags.get("addr:housenumber", ""),
        tags.get("addr:street", ""),
    ]
    address = " ".join(p for p in address_parts if p).strip() or None
    country_code = (tags.get("addr:country") or "").upper()[:2] or None

    return VenueRecord(
        source=SOURCE,
        external_id=external_id,
        name=name,
        lat=lat,
        lon=lon,
        family_slug=family_slug,
        primary_sport_slug=sport_slug,
        address=address,
        country_code=country_code,
        is_published=True,
    )


def fetch_family_records(
    family: str,
    bbox: tuple[float, float, float, float],
    limit: int | None,
) -> list[VenueRecord]:
    """Récupère et mappe tous les POI OSM pour une famille dans une bbox."""
    tags = FAMILY_TAGS[family]
    seen_extids: set[str] = set()
    records: list[VenueRecord] = []
    dropped = 0  # #463 — écartés car visiblement mal classés (nom ≠ sport)

    for tag_key, tag_value in tags:
        if limit and len(records) >= limit:
            break
        family_slug, sport_slug = TAG_MAP[(tag_key, tag_value)]
        q = build_overpass_query(tag_key, tag_value, bbox)
        print(f"    ▶ Overpass {tag_key}={tag_value} …", flush=True)
        try:
            elements = fetch_overpass(q)
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ erreur Overpass {tag_key}={tag_value}: {e}", flush=True)
            continue

        for el in elements:
            r = element_to_record(el, family_slug, sport_slug)
            if r is None or r.external_id in seen_extids:
                continue
            # #463 — filtre anti-mauvaise-classif (nom signalant un autre sport
            # d'une autre famille, ex. pêche/golf/boules sur un sport de raquette).
            if is_misclassified(r.name, r.primary_sport_slug):
                dropped += 1
                continue
            seen_extids.add(r.external_id)
            records.append(r)
            if limit and len(records) >= limit:
                break
        suffix = f", {dropped} écartés (mauvaise classif)" if dropped else ""
        print(
            f"      → {len(elements)} éléments, {len(records)} records total{suffix}",
            flush=True,
        )

    return records


# ── Run principal ──────────────────────────────────────────────────────────────

def load_env_client() -> SupabaseRestClient:
    env: dict[str, str] = {}
    env_file = _REPO_ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (env.get("NEXT_PUBLIC_SUPABASE_URL")
           or os.getenv("SUPABASE_URL")
           or os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not url or not key:
        print("❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return SupabaseRestClient(url, key)


def run(args: argparse.Namespace) -> int:
    families = list(FAMILY_TAGS.keys()) if args.family == "all" else [args.family]
    bbox = COUNTRY_BBOXES.get(args.country.upper())
    if bbox is None:
        print(f"❌ Pays inconnu : {args.country}. Disponibles : {list(COUNTRY_BBOXES)}", file=sys.stderr)
        return 1

    scope = f"{args.family}/{args.country.upper()}"
    mode = "DRY-RUN" if args.dry_run else "APPLY"
    print(f"▶ osm_import {scope} · {mode}" + (f" · limit={args.limit}" if args.limit else ""))

    if not args.dry_run:
        client = load_env_client()

    run_id: str | None = None
    total = UpsertResult()
    all_seen_extids: set[str] = set()

    for family in families:
        print(f"\n  📦 famille : {family}")
        records = fetch_family_records(family, bbox, args.limit)
        print(f"  ✓ {len(records):,} records trouvés")

        if args.dry_run:
            print(f"  ✓ [DRY-RUN] {len(records):,} records (aucune écriture)")
            continue

        # Ouvre le run_id au premier batch non-dry
        if run_id is None:
            run_id = open_import_run(client, SOURCE, scope, runner="local")
            print(f"  import_run id={run_id}")

        result = upsert_venues_batch(client, records, chunk_size=args.chunk)
        total = total.merge(result)
        all_seen_extids.update(r.external_id for r in records)
        print(f"  ✓ upserted={result.upserted} skipped={result.skipped} errors={len(result.errors)}")
        if result.errors:
            for e in result.errors[:5]:
                print(f"    ⚠ {e}")

    # Soft-delete des venues de cette source/pays non vus dans le batch.
    # Seul pour un pays précis (pas pour "all" global, évite les faux positifs).
    soft_deleted = 0
    if run_id and args.country.upper() != "EU" and all_seen_extids:
        # #426 — scope par famille pour un import mono-famille (sinon on
        # soft-delete les autres familles, source+pays, absentes de ce batch).
        # `None` pour --family all = réconciliation complète.
        fam_scope = None if args.family == "all" else args.family
        print(
            f"\n  🗑 réconciliation soft-delete "
            f"({args.country.upper()}/{fam_scope or 'all'}) …",
            flush=True,
        )
        soft_deleted = soft_delete_missing(
            client, SOURCE, args.country.upper(), all_seen_extids,
            family_slug=fam_scope,
        )
        print(f"  ✓ soft-deleted={soft_deleted}")

    if run_id:
        err = "; ".join(total.errors[:3]) or None
        close_import_run(client, run_id, total, soft_deleted=soft_deleted, error=err)
        print(f"\n✅ import_run fermé · total upserted={total.upserted} skipped={total.skipped}")
    elif not args.dry_run:
        print("\n✅ aucun record à écrire")
    else:
        print(f"\n✅ DRY-RUN terminé · total records={sum(len(fetch_family_records(f, bbox, args.limit)) for f in families)}" if False else f"\n✅ DRY-RUN terminé")

    return 0


# ── Self-test ─────────────────────────────────────────────────────────────────

def self_test() -> int:
    """Tests sur la logique pure (sans réseau)."""
    # build_overpass_query
    q = build_overpass_query("sport", "tennis", (41.3, -5.1, 51.1, 9.6))
    assert 'sport"="tennis"' in q, f"query manque le tag: {q}"
    assert "41.3,-5.1,51.1,9.6" in q, f"bbox absente: {q}"
    assert "out center tags" in q

    # element_to_record — node avec nom
    el_node = {
        "type": "node", "id": 123,
        "lat": 48.85, "lon": 2.35,
        "tags": {"name": "TC Paris 15", "sport": "tennis", "addr:country": "FR"},
    }
    r = element_to_record(el_node, "raquette", "tennis")
    assert r is not None
    assert r.external_id == "osm/node/123"
    assert r.name == "TC Paris 15"
    assert r.country_code == "FR"
    assert r.family_slug == "raquette"

    # element_to_record — way avec center
    el_way = {
        "type": "way", "id": 456,
        "center": {"lat": 43.3, "lon": 5.4},
        "tags": {"name": "Padel Club Marseille"},
    }
    r2 = element_to_record(el_way, "raquette", "padel")
    assert r2 is not None
    assert r2.external_id == "osm/way/456"
    assert r2.lat == 43.3

    # element_to_record — sans nom → None
    el_noname = {"type": "node", "id": 789, "lat": 1.0, "lon": 1.0, "tags": {}}
    assert element_to_record(el_noname, "raquette", "tennis") is None

    # element_to_record — coords invalides → None
    el_bad = {"type": "node", "id": 0, "lat": 999.0, "lon": 0.0, "tags": {"name": "X"}}
    assert element_to_record(el_bad, "raquette", "tennis") is None

    # TAG_MAP couvre toutes les familles déclarées dans FAMILY_TAGS
    for fam, tags in FAMILY_TAGS.items():
        for tag in tags:
            assert tag in TAG_MAP, f"TAG_MAP manque {tag} (famille {fam})"

    # Toutes les 13 familles actives + plus sont couvertes
    expected_families = {
        "raquette", "fitness", "combat", "yoga", "baignade", "boules",
        "nautique", "glisse", "snow", "hike", "escalade", "ballon", "plus",
    }
    assert expected_families <= set(FAMILY_TAGS.keys()), (
        f"Familles manquantes: {expected_families - set(FAMILY_TAGS.keys())}"
    )

    # COUNTRY_BBOXES : toutes les bboxes sont (S, W, N, E) valides
    for country, (s, w, n, e) in COUNTRY_BBOXES.items():
        assert s < n, f"{country}: S >= N"
        assert w < e, f"{country}: W >= E"

    print("✓ osm_import self-test OK")
    return 0


# ── Entrée ────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Import OSM Overpass → Supabase (#227)")
    p.add_argument("--family", choices=[*sorted(FAMILY_TAGS.keys()), "all"], default="raquette")
    p.add_argument("--country", default="FR", help="ISO-2 ou EU")
    p.add_argument("--limit", type=int, default=None, help="Cap venues (test)")
    p.add_argument("--dry-run", action="store_true", help="Aucune écriture DB")
    p.add_argument("--chunk", type=int, default=100, help="Taille lots upsert")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
