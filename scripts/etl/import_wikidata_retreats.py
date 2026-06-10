#!/usr/bin/env python3
"""import_wikidata_retreats.py — peuple la famille `retraites` depuis Wikidata (#97).

La famille `retraites` (Retraites & camps) était à **0 venue** : ni dans le
SQLite V1 (table retreat_events vide, pas de sport_family retraites), ni dans
OSM/Overture. Source publique structurée avec coordonnées : **Wikidata** (déjà
utilisée par le cron refresh-wikidata).

Récupère ashrams / retreat centers / meditation centers géolocalisés via SPARQL
(cf. /tmp/fetch_retreats.py → /tmp/retreats_wikidata.json), mappe vers des venues
`family=retraites` et upserte (idempotent par (source, external_id)).

Mapping classe Wikidata → sport :
  - ashram            → yoga_retreat
  - retreat center    → wellness_retreat
  - meditation center → wellness_retreat

Connexion : SUPABASE_DB_PASSWORD (+ défauts pooler). dry-run par défaut.

Usage :
    python3 scripts/etl/import_wikidata_retreats.py [--input FICHIER]   # dry-run
    python3 scripts/etl/import_wikidata_retreats.py --apply
    python3 scripts/etl/import_wikidata_retreats.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

SOURCE = "wikidata-retreats"
CLASS_TO_SPORT = {
    "ashram": "yoga_retreat",
    "retreat center": "wellness_retreat",
    "meditation center": "wellness_retreat",
}
DEFAULT_SPORT = "wellness_retreat"


def derive_slug(external_id: str) -> str:
    h = hashlib.sha256(f"{SOURCE}:{external_id}".encode()).hexdigest()[:8]
    return f"{SOURCE}-{h}"


def to_row(it: dict) -> dict:
    sport = CLASS_TO_SPORT.get((it.get("cls") or "").strip().lower(), DEFAULT_SPORT)
    ext = f"wikidata/{it['qid']}"
    return {
        "slug": derive_slug(ext),
        "name": it["name"],
        "lat": float(it["lat"]),
        "lon": float(it["lon"]),
        "family_slug": "retraites",
        "primary_sport_slug": sport,
        # retreat_type = même valeur que le sport (yoga_retreat / wellness_retreat,
        # qui SONT des retreat_type valides). Requis : la page /famille/retraites
        # filtre sur retreat_type IS NOT NULL (#97).
        "retreat_type": sport,
        "source": SOURCE,
        "external_id": ext,
        "is_published": True,
    }


def load_items(path: str) -> list[dict]:
    items = json.load(open(path))
    # Filtre qualité minimal : nom non-QID, coords plausibles.
    out, seen = [], set()
    for it in items:
        nm = (it.get("name") or "").strip()
        if not nm or nm.startswith("Q") and nm[1:].isdigit():
            continue
        if not (-90 <= float(it["lat"]) <= 90 and -180 <= float(it["lon"]) <= 180):
            continue
        if it["qid"] in seen:
            continue
        seen.add(it["qid"])
        out.append(it)
    return out


def connect():
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("❌ SUPABASE_DB_PASSWORD manquant.", file=sys.stderr); sys.exit(1)
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw, dbname="postgres", sslmode="require", connect_timeout=20,
    )


def run(args) -> int:
    items = load_items(args.input)
    rows = [to_row(it) for it in items]
    from collections import Counter
    by_sport = Counter(r["primary_sport_slug"] for r in rows)
    print(f"retraites valides : {len(rows)} (sur {len(json.load(open(args.input)))} brutes)")
    print(f"  par sport : {dict(by_sport)}")
    for r in rows[:8]:
        print(f"    {r['name'][:38]:38} {r['lat']:.3f},{r['lon']:.3f}  {r['primary_sport_slug']}")

    if not args.apply:
        print("\n[DRY-RUN] aucune écriture.")
        return 0

    conn = connect(); conn.autocommit = True
    cur = conn.cursor(); cur.execute("SET statement_timeout='120s'")
    ins = 0
    for r in rows:
        cur.execute(
            """INSERT INTO venue (slug, name, lat, lon, family_slug, primary_sport_slug,
                                  retreat_type, source, external_id, is_published)
               VALUES (%(slug)s,%(name)s,%(lat)s,%(lon)s,%(family_slug)s,%(primary_sport_slug)s,
                       %(retreat_type)s,%(source)s,%(external_id)s,%(is_published)s)
               ON CONFLICT (source, external_id)
               DO UPDATE SET retreat_type = EXCLUDED.retreat_type""", r)
        ins += cur.rowcount
    print(f"\n✅ venues upsertées (retreat_type posé) : {ins} / {len(rows)}")
    # venue_sport (discipline primaire) pour toutes les venues de la source.
    cur.execute(
        """INSERT INTO venue_sport (venue_id, sport_slug, is_primary)
           SELECT v.id, v.primary_sport_slug, true FROM venue v
           WHERE v.source=%s AND v.deleted_at IS NULL
           ON CONFLICT (venue_id, sport_slug) DO NOTHING""", (SOURCE,))
    print(f"✅ venue_sport (discipline) posés : {cur.rowcount}")
    cur.close(); conn.close()
    return 0


def self_test() -> int:
    r = to_row({"qid": "Q42", "name": "Test Ashram", "lat": 48.85, "lon": 2.35, "cls": "ashram"})
    assert r["family_slug"] == "retraites" and r["primary_sport_slug"] == "yoga_retreat"
    assert r["retreat_type"] == "yoga_retreat"  # = sport, pour /famille/retraites (#97)
    assert r["source"] == SOURCE and r["external_id"] == "wikidata/Q42"
    assert r["slug"].startswith("wikidata-retreats-")
    assert to_row({"qid": "Q1", "name": "X", "lat": 0, "lon": 0, "cls": "retreat center"})["primary_sport_slug"] == "wellness_retreat"
    assert to_row({"qid": "Q2", "name": "Y", "lat": 0, "lon": 0, "cls": None})["primary_sport_slug"] == "wellness_retreat"
    print("✓ import_wikidata_retreats self-test OK")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Import retraites Wikidata (#97)")
    p.add_argument("--input", default="/tmp/retreats_wikidata.json")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
