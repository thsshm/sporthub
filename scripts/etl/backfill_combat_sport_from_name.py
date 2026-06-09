#!/usr/bin/env python3
"""backfill_combat_sport_from_name.py — dérive primary_sport_slug des venues combat (#97/#312).

~39 440 venues `family_slug='combat'` (source overture) ont `primary_sport_slug`
NULL et aucun `venue_sport` → invisibles sur /sports/boxing, /sports/judo, etc.
Leur NOM porte souvent le sport précis (« Karaté Goju Ryu », « Kickboxing »,
« MMA », « Judo Club », « Jiu-Jitsu »…).

Ce script dérive le sport depuis le NOM (frontières de mot, conservateur : NULL
si aucun mot-clé clair — ex. taekwondo / krav maga / kung-fu n'ont pas de slug
V2 → laissés NULL). Pose primary_sport_slug + venue_sport (is_primary).

Slugs combat valides : boxing, judo, karate, mma, bjj.
Connexion : SUPABASE_DB_PASSWORD (+ défauts pooler). dry-run par défaut.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata


def _norm(s: str) -> str:
    d = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in d if not unicodedata.combining(c)).lower()


# Ordre = priorité (le 1er match gagne). Termes en frontières de mot.
# bjj/mma avant boxing/karate pour éviter qu'un terme générique prime.
COMBAT_RULES: list[tuple[str, list[str]]] = [
    ("bjj", ["bjj", "jiu jitsu", "jiu-jitsu", "jujitsu", "jiujitsu", "gracie", "brazilian jiu"]),
    ("mma", ["mma", "mixed martial", "free fight", "freefight", "pancrace"]),
    ("judo", ["judo", "jujutsu"]),
    ("karate", ["karate", "shotokan", "goju", "shukokai", "wado", "kyokushin",
                "shito ryu", "shitoryu", "shorin"]),
    ("boxing", ["boxing", "boxe", "kickboxing", "kick boxing", "kick-boxing",
                "savate", "muay thai", "muaythai", "boxe thai", "boxe anglaise",
                "boxe francaise", "pugilat"]),
]
_COMPILED = [
    (slug, [re.compile(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])") for t in terms])
    for slug, terms in COMBAT_RULES
]


def derive_sport(name: str) -> str | None:
    n = _norm(name)
    for slug, pats in _COMPILED:
        if any(p.search(n) for p in pats):
            return slug
    return None


def connect():
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("❌ SUPABASE_DB_PASSWORD manquant.", file=sys.stderr); sys.exit(1)
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw, dbname="postgres", sslmode="require", connect_timeout=20)


def run(args) -> int:
    conn = connect(); conn.autocommit = False
    cur = conn.cursor(); cur.execute("SET statement_timeout='120s'")
    cur.execute("""SELECT id, name FROM venue
                   WHERE is_published AND deleted_at IS NULL
                     AND family_slug='combat' AND primary_sport_slug IS NULL
                     AND name IS NOT NULL""")
    rows = cur.fetchall()
    derived = [(vid, derive_sport(nm)) for vid, nm in rows]
    hits = [(vid, s) for vid, s in derived if s]
    from collections import Counter
    by = Counter(s for _, s in hits)
    print(f"combat NULL-primary : {len(rows)} ; dérivés du nom : {len(hits)} ({100*len(hits)//max(len(rows),1)}%)")
    print(f"  par sport : {dict(by)}")

    if not args.apply:
        conn.rollback(); cur.close(); conn.close()
        print("[DRY-RUN] aucune écriture.")
        return 0

    # Écriture ROBUSTE par lots : UPDATE ... FROM (VALUES ...) — quelques
    # statements au lieu de 11k allers-retours (le pooler session timeoutait).
    from psycopg2.extras import execute_values
    n = 0
    for i in range(0, len(hits), 500):
        chunk = hits[i:i + 500]
        execute_values(cur,
            "UPDATE venue v SET primary_sport_slug = d.slug "
            "FROM (VALUES %s) AS d(id, slug) "
            "WHERE v.id = d.id::uuid AND v.primary_sport_slug IS NULL",
            chunk)
        conn.commit()
        n += len(chunk)
        print(f"  … {n}/{len(hits)}", flush=True)
    # venue_sport (discipline primaire) en set-based pour tout le combat désormais classé.
    cur.execute(
        "INSERT INTO venue_sport (venue_id, sport_slug, is_primary) "
        "SELECT id, primary_sport_slug, true FROM venue "
        "WHERE family_slug='combat' AND primary_sport_slug IS NOT NULL "
        "  AND deleted_at IS NULL AND is_published "
        "ON CONFLICT (venue_id, sport_slug) DO NOTHING")
    conn.commit()
    print(f"✅ primary_sport_slug dérivé ({n}) + venue_sport posés ({cur.rowcount})")
    cur.close(); conn.close()
    return 0


def self_test() -> int:
    cases = {
        "Karaté Goju Ryu d'Okinawa": "karate", "Kickboxing y Artes Marciales": "boxing",
        "Pyranha MMA Offenbach": "mma", "Judo Club Lyon": "judo",
        "Gracie Barra Jiu-Jitsu": "bjj", "Boxe Anglaise Paris": "boxing",
        "Bojeon Taekwondo Club": None, "Krav Maga Close Combat": None,
        "Wing Chun Kung Fu": None,
    }
    for name, expected in cases.items():
        got = derive_sport(name)
        assert got == expected, f"{name!r} → {got} (attendu {expected})"
    print("✓ backfill_combat_sport_from_name self-test OK")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Dérive le sport combat depuis le nom (#97)")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    return self_test() if args.self_test else run(args)


if __name__ == "__main__":
    raise SystemExit(main())
