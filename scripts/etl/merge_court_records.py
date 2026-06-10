#!/usr/bin/env python3
"""merge_court_records.py — fusionne les enregistrements court-level en 1 carte venue (#554).

La source RES (entre autres) importe chaque court comme une venue séparée :
« Court de Padel 1/2/3 », « Sportfield 16 piste 1/2/3 », « Terrain n°4 »… → gonfle
les listes SEO et l'UX. On regroupe les courts d'un même club (même nom de base +
même lieu ~100 m + même source + même sport) en UNE venue (le canonique reçoit
`courts_count` = taille du groupe), les autres sont soft-deleted (réversible).

CONSERVATEUR :
  - groupe seulement si ≥ 2 membres partagent base+lieu+source+sport (un « Stade
    2000 » isolé n'a pas de frère → jamais touché) ;
  - skip tout membre portant claim/favori/booking.

Connexion : SUPABASE_DB_PASSWORD (+ défauts pooler). dry-run par défaut.
Conçu pour tourner en GitHub Actions (secrets), le pooler local pouvant échouer.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from collections import defaultdict


def _norm(s: str) -> str:
    d = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in d if not unicodedata.combining(c)).lower().strip()


_NUM_SUFFIX = re.compile(r"\s+n?[°o]?\s*\d+\s*$", re.IGNORECASE)
_COURT_WORD = re.compile(
    r"\s+(piste|court|terrain|cancha|pista|field|lane|kart)\s*$", re.IGNORECASE)


def base_name(name: str) -> str | None:
    """Nom de base si `name` ressemble à un court numéroté, sinon None."""
    stripped = _NUM_SUFFIX.sub("", name).strip()
    if stripped == name.strip() or not stripped:
        return None  # pas de numéro en fin → pas un court-record
    return stripped


def display_name(group_base: str) -> str:
    """Nom de carte = base sans le mot-court résiduel (« … piste » → « … »)."""
    n = _COURT_WORD.sub("", group_base).strip()
    return n or group_base


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


def has_user_data(cur, vid) -> bool:
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM claim_request WHERE venue_id=%s) "
        "OR EXISTS(SELECT 1 FROM user_favorite WHERE venue_id=%s) "
        "OR EXISTS(SELECT 1 FROM booking_link WHERE venue_id=%s)", (vid, vid, vid))
    return cur.fetchone()[0]


def run(args) -> int:
    conn = connect(); conn.autocommit = False
    cur = conn.cursor(); cur.execute("SET statement_timeout='120s'")
    # Candidats : nom avec numéro en fin (pré-filtre SQL grossier).
    cur.execute("""
        SELECT id, name, source, primary_sport_slug, family_slug,
               round(lat::numeric,3), round(lon::numeric,3), COALESCE(courts_count,1)
        FROM venue
        WHERE is_published AND deleted_at IS NULL AND name IS NOT NULL
          AND name ~ '[0-9]\\s*$'
    """)
    groups: dict = defaultdict(list)
    for vid, name, source, sport, fam, la, lo, cc in cur.fetchall():
        b = base_name(name)
        if not b:
            continue
        key = (_norm(b), source, sport, str(la), str(lo))
        groups[key].append({"id": vid, "name": name, "base": b, "courts": cc})

    clusters = {k: v for k, v in groups.items() if len(v) > 1}
    n_clusters = len(clusters)
    n_dups = sum(len(v) - 1 for v in clusters.values())
    print(f"clusters court-level (même base+lieu+source+sport, ≥2) : {n_clusters}")
    print(f"  → records à fusionner (soft-delete) : {n_dups}")
    print("  exemples :")
    for (b, src, sp, la, lo), members in list(clusters.items())[:10]:
        print(f"    [{src}/{sp}] {display_name(members[0]['base'])[:34]} ← {len(members)} courts")

    if not args.apply:
        conn.rollback(); cur.close(); conn.close()
        print("[DRY-RUN] aucune écriture.")
        return 0

    merged = removed = skipped = 0
    for (b, src, sp, la, lo), members in clusters.items():
        safe = [m for m in members if not has_user_data(cur, m["id"])]
        if len(safe) < 2:
            skipped += len(members); continue
        canonical = sorted(safe, key=lambda m: str(m["id"]))[0]
        dups = [m for m in safe if m["id"] != canonical["id"]]
        total_courts = sum(m["courts"] for m in safe)
        cur.execute("UPDATE venue SET name=%s, courts_count=%s WHERE id=%s",
                    (display_name(canonical["base"]), total_courts, canonical["id"]))
        for d in dups:
            cur.execute("UPDATE venue SET deleted_at=now() WHERE id=%s AND deleted_at IS NULL", (d["id"],))
        conn.commit()
        merged += 1; removed += len(dups)
        if merged % 200 == 0:
            print(f"  … {merged} clusters fusionnés ({removed} records)", flush=True)
    print(f"\n✅ {merged} clusters fusionnés, {removed} records soft-deleted (skip données-user : {skipped})")
    cur.close(); conn.close()
    return 0


def self_test() -> int:
    assert base_name("Court de Padel 1") == "Court de Padel"
    assert base_name("Sportfield 16 piste 1") == "Sportfield 16 piste"
    assert display_name("Sportfield 16 piste") == "Sportfield 16"
    assert base_name("Terrain n°4") == "Terrain"
    assert base_name("Tennis Club de Lyon") is None      # pas de numéro
    assert base_name("Stade 2000") == "Stade"            # capté, mais sans frère → non fusionné
    print("✓ merge_court_records self-test OK")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Fusion court-level → venue (#554)")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    return self_test() if args.self_test else run(args)


if __name__ == "__main__":
    raise SystemExit(main())
