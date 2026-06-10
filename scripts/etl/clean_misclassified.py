#!/usr/bin/env python3
"""clean_misclassified.py — soft-delete rétroactif des venues mal classées (#553/#463).

Applique `cleaning.is_misclassified` (signal de nom INTER-familles : pêche/golf/
boules + #553 piscine/musculation/crossfit) aux venues PUBLIÉES dont le sport
primaire est surveillé, et soft-delete celles dont le nom contredit le sport
(ex. « Piscine découverte » taguée tennis). Réversible (`deleted_at`).

Conservateur : ne tranche que sur conflit inter-familles (cf. cleaning.py).
Connexion : SUPABASE_DB_PASSWORD (+ défauts pooler). dry-run par défaut.
Conçu pour GitHub Actions (secrets) — pooler local peu fiable.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from cleaning import is_misclassified, misclassification_reason, _SPORT_FAMILY  # noqa: E402


def connect():
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("❌ SUPABASE_DB_PASSWORD manquant.", file=sys.stderr); sys.exit(1)
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw, dbname="postgres", sslmode="require", connect_timeout=25)


def run(args) -> int:
    conn = connect(); conn.autocommit = True
    cur = conn.cursor(); cur.execute("SET statement_timeout='120s'")
    # Sports ASSIGNÉS surveillés (ceux dont une mauvaise classif a un sens) :
    watched = [s for s in _SPORT_FAMILY if s not in ("fishing", "pool", "gym")]
    cur.execute("""SELECT id, name, primary_sport_slug FROM venue
      WHERE is_published AND deleted_at IS NULL AND primary_sport_slug = ANY(%s)""", (watched,))
    rows = cur.fetchall()
    bad = [(i, n, s) for (i, n, s) in rows if is_misclassified(n, s)]

    def term(n, s):
        r = misclassification_reason(n, s)
        return r.split("'")[1] if r and "'" in r else "?"

    by_term = Counter(term(n, s) for _, n, s in bad)
    print(f"venues sport surveillé : {len(rows):,} ; mal classées : {len(bad)}")
    print(f"  par signal conflictuel : {dict(by_term)}")
    for i, n, s in bad[:15]:
        print(f"    [{term(n, s)}←{s}] {n[:45]}")

    if not args.apply:
        cur.close(); conn.close()
        print("[DRY-RUN] aucune écriture.")
        return 0

    ids = [i for i, _, _ in bad]
    # Soft-delete par lots.
    B = 5000
    total = 0
    for k in range(0, len(ids), B):
        chunk = ids[k:k + B]
        cur.execute("UPDATE venue SET deleted_at = now() WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL", (chunk,))
        total += cur.rowcount
    print(f"✅ soft-deleted : {total}")
    cur.close(); conn.close()
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Soft-delete rétroactif mal classées (#553)")
    p.add_argument("--apply", action="store_true")
    args = p.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
