#!/usr/bin/env python3
"""backfill_hyrox_disciplines.py — disciplines des venues Hyrox (#476).

Les venues `source='hyrox'` ont `primary_sport_slug='hyrox'` mais un `venue_sport`
VIDE → la fiche s'affiche « Hyrox seul ». Un partenaire Hyrox est de fait une
salle (gym). Ce script écrit les disciplines manquantes dans `venue_sport` :
  - venues hyrox : `hyrox` (is_primary) + `gym`
  - canoniques ayant absorbé un doublon hyrox à la dédup #463 (via external_ref
    source='hyrox') : ajoute `hyrox` (non primaire ; le canonique garde son gym).

Idempotent (ON CONFLICT (venue_id, sport_slug) DO NOTHING). Réversible.
Connexion : SUPABASE_DB_PASSWORD (+ SUPABASE_DB_HOST/USER/PORT, défauts pooler).

Usage :
    python3 scripts/etl/backfill_hyrox_disciplines.py            # dry-run
    python3 scripts/etl/backfill_hyrox_disciplines.py --apply
    python3 scripts/etl/backfill_hyrox_disciplines.py --self-test
"""
from __future__ import annotations

import argparse
import os
import sys

# (sport_slug, is_primary) ajoutés à chaque venue Hyrox.
HYROX_DISCIPLINES = [("hyrox", True), ("gym", False)]


def connect():
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("❌ SUPABASE_DB_PASSWORD manquant.", file=sys.stderr)
        sys.exit(1)
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw, dbname="postgres", sslmode="require", connect_timeout=20,
    )


# SQL set-based (un seul statement chacun ; ~17k lignes, OK sous 120s).
SQL_BACKFILL_HYROX = """
INSERT INTO venue_sport (venue_id, sport_slug, is_primary)
SELECT v.id, x.slug, x.prim
FROM venue v
CROSS JOIN (VALUES ('hyrox', true), ('gym', false)) AS x(slug, prim)
WHERE v.source = 'hyrox' AND v.deleted_at IS NULL
ON CONFLICT (venue_id, sport_slug) DO NOTHING
"""

SQL_BACKFILL_MERGED = """
INSERT INTO venue_sport (venue_id, sport_slug, is_primary)
SELECT DISTINCT er.venue_id, 'hyrox', false
FROM external_ref er
JOIN venue v ON v.id = er.venue_id AND v.deleted_at IS NULL
WHERE er.source = 'hyrox'
ON CONFLICT (venue_id, sport_slug) DO NOTHING
"""

# Comptes "ce qui manque" pour le dry-run (lignes qui seraient insérées).
SQL_DRY = """
SELECT
  (SELECT count(*) FROM venue v WHERE v.source='hyrox' AND v.deleted_at IS NULL) AS hyrox_venues,
  (SELECT count(*) FROM venue v WHERE v.source='hyrox' AND v.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM venue_sport vs WHERE vs.venue_id=v.id AND vs.sport_slug='gym')) AS manque_gym,
  (SELECT count(*) FROM venue v WHERE v.source='hyrox' AND v.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM venue_sport vs WHERE vs.venue_id=v.id AND vs.sport_slug='hyrox')) AS manque_hyrox,
  (SELECT count(DISTINCT er.venue_id) FROM external_ref er JOIN venue v ON v.id=er.venue_id
     AND v.deleted_at IS NULL WHERE er.source='hyrox'
     AND NOT EXISTS (SELECT 1 FROM venue_sport vs WHERE vs.venue_id=er.venue_id AND vs.sport_slug='hyrox')) AS canoniques_manque_hyrox
"""


def run(args) -> int:
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout='120s'")

    cur.execute(SQL_DRY)
    hv, mg, mh, cm = cur.fetchone()
    print(f"venues hyrox publiées        : {hv}")
    print(f"  manque discipline 'gym'    : {mg}")
    print(f"  manque discipline 'hyrox'  : {mh}")
    print(f"canoniques (dédup) manque 'hyrox' : {cm}")

    if not args.apply:
        print("\n[DRY-RUN] aucune écriture.")
        cur.close(); conn.close()
        return 0

    cur.execute(SQL_BACKFILL_HYROX)
    print(f"\n✅ venue_sport hyrox/gym ajoutés (venues hyrox) : {cur.rowcount}")
    cur.execute(SQL_BACKFILL_MERGED)
    print(f"✅ 'hyrox' ajouté aux canoniques post-dédup : {cur.rowcount}")
    cur.close(); conn.close()
    return 0


def self_test() -> int:
    assert HYROX_DISCIPLINES == [("hyrox", True), ("gym", False)]
    assert sum(1 for _, p in HYROX_DISCIPLINES if p) == 1  # exactement un primaire
    print("✓ backfill_hyrox_disciplines self-test OK")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Backfill disciplines venues Hyrox (#476)")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (défaut : dry-run)")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
