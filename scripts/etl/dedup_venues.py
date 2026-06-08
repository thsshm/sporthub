#!/usr/bin/env python3
"""dedup_venues.py — fusion conservatrice des doublons CROSS-SOURCE (#463).

Un même lieu physique est parfois importé par plusieurs sources (ex. une salle
présente à la fois en `hyrox` et en `overture`, un club de tennis en `overture`
et `res-raquette`). Ce script détecte ces doublons et les fusionne dans un
record canonique, SANS perte (union venue_sport/venue_amenity, provenance en
external_ref, soft-delete du doublon → réversible via restore_soft_deleted.py).

PRUDENCE (cf. #463) :
  - On ne traite QUE les groupes CROSS-SOURCE (≥2 sources). Les grappes
    MÊME-SOURCE (ex. « parc des sports » ×6 en OSM = 6 équipements distincts)
    NE SONT PAS des doublons → ignorées.
  - On n'auto-fusionne QUE si tous les membres ont le MÊME family_slug. Les
    groupes cross-famille sont reportés (revue manuelle), jamais fusionnés.
  - Tout doublon portant une donnée utilisateur (claim/favori/booking) est
    SKIPPÉ par sécurité.

Connexion : variables d'env SUPABASE_DB_PASSWORD (+ éventuellement
SUPABASE_DB_HOST/USER/PORT ; défauts = pooler session du projet).

Usage :
    python3 scripts/etl/dedup_venues.py                 # dry-run (rapport, 0 écriture)
    python3 scripts/etl/dedup_venues.py --apply         # applique tout
    python3 scripts/etl/dedup_venues.py --apply --max-groups 20   # lot pilote
    python3 scripts/etl/dedup_venues.py --self-test
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from collections import defaultdict

# Priorité de source pour choisir le record canonique (plus petit = préféré).
SOURCE_PRIORITY = [
    "res-raquette", "res-boules", "paris-mairie", "overture",
    "osm", "hyrox", "kitesurf-marinas",
]
# Rayon max accepté dans un groupe (m). Au-delà → groupe suspect, on skippe.
MAX_SPREAD_M = 150.0


def source_rank(s: str) -> int:
    return SOURCE_PRIORITY.index(s) if s in SOURCE_PRIORITY else len(SOURCE_PRIORITY)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def pick_canonical(members: list[dict]) -> dict:
    """Déterministe : enrichissements > nb sports > priorité source > ancienneté."""
    return sorted(
        members,
        key=lambda m: (
            not m["has_enr"],
            -m["sport_count"],
            source_rank(m["source"]),
            m["created_at"],
            str(m["id"]),
        ),
    )[0]


def group_spread_m(members: list[dict]) -> float:
    """Distance max entre deux membres du groupe."""
    mx = 0.0
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            d = haversine_m(members[i]["lat"], members[i]["lon"],
                            members[j]["lat"], members[j]["lon"])
            mx = max(mx, d)
    return mx


# ── DB ───────────────────────────────────────────────────────────────────────
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


def fetch_groups(cur) -> list[list[dict]]:
    """Groupes candidats : même nom normalisé + même cellule ~100 m + ≥2 sources."""
    cur.execute(
        """
        WITH cell AS (
          SELECT id, lower(btrim(name)) AS nm,
                 round(lat::numeric, 3) AS la, round(lon::numeric, 3) AS lo,
                 lat, lon, source, family_slug,
                 (enrichments IS NOT NULL AND enrichments::text <> '{}') AS has_enr,
                 created_at,
                 (SELECT count(*) FROM venue_sport vs WHERE vs.venue_id = venue.id) AS sport_count
          FROM venue
          WHERE is_published AND deleted_at IS NULL AND name IS NOT NULL
        ),
        grp AS (
          SELECT nm, la, lo FROM cell
          GROUP BY nm, la, lo
          HAVING count(*) > 1 AND count(DISTINCT source) > 1
        )
        SELECT c.nm, c.la, c.lo, c.id, c.source, c.family_slug, c.has_enr,
               c.created_at, c.lat, c.lon, c.sport_count
        FROM cell c JOIN grp g USING (nm, la, lo)
        ORDER BY c.nm, c.la, c.lo
        """
    )
    by_key: dict = defaultdict(list)
    for r in cur.fetchall():
        nm, la, lo, vid, source, fam, has_enr, created, lat, lon, sc = r
        by_key[(nm, la, lo)].append({
            "id": vid, "source": source, "family_slug": fam, "has_enr": has_enr,
            "created_at": created, "lat": float(lat), "lon": float(lon), "sport_count": sc,
        })
    return list(by_key.values())


def has_user_data(cur, vid) -> bool:
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM claim_request WHERE venue_id=%s) "
        "OR EXISTS(SELECT 1 FROM user_favorite WHERE venue_id=%s) "
        "OR EXISTS(SELECT 1 FROM booking_link WHERE venue_id=%s)",
        (vid, vid, vid),
    )
    return cur.fetchone()[0]


def merge_group(conn, canonical, dups) -> None:
    """Fusionne dups → canonical, en une transaction. Soft-delete des dups."""
    cur = conn.cursor()
    cid = canonical["id"]
    for d in dups:
        did = d["id"]
        cur.execute(
            "INSERT INTO venue_sport (venue_id, sport_slug, is_primary, courts_count, surface) "
            "SELECT %s, sport_slug, false, courts_count, surface FROM venue_sport WHERE venue_id=%s "
            "ON CONFLICT (venue_id, sport_slug) DO NOTHING", (cid, did))
        cur.execute(
            "INSERT INTO venue_amenity (venue_id, amenity_slug, detail) "
            "SELECT %s, amenity_slug, detail FROM venue_amenity WHERE venue_id=%s "
            "ON CONFLICT (venue_id, amenity_slug) DO NOTHING", (cid, did))
        # Provenance : (source, external_id) du doublon → external_ref du canonique.
        cur.execute(
            "INSERT INTO external_ref (venue_id, source, external_id, payload_json) "
            "SELECT %s, source, external_id, jsonb_build_object('merged_from', id::text) "
            "FROM venue WHERE id=%s AND external_id IS NOT NULL "
            "ON CONFLICT (source, external_id) DO NOTHING", (cid, did))
        # Re-pointe les external_ref existants du doublon (sans collision).
        cur.execute(
            "UPDATE external_ref er SET venue_id=%s WHERE er.venue_id=%s "
            "AND NOT EXISTS (SELECT 1 FROM external_ref e2 WHERE e2.source=er.source "
            "AND e2.external_id=er.external_id AND e2.venue_id=%s)", (cid, did, cid))
        cur.execute("UPDATE venue SET deleted_at=now() WHERE id=%s AND deleted_at IS NULL", (did,))
    conn.commit()


def run(args) -> int:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SET statement_timeout='120s'")
    groups = fetch_groups(cur)

    eligible = []          # (canonical, dups)
    cross_family = 0
    spread_skip = 0
    for members in groups:
        if len({m["family_slug"] for m in members}) > 1:
            cross_family += 1
            continue
        if group_spread_m(members) > MAX_SPREAD_M:
            spread_skip += 1
            continue
        canonical = pick_canonical(members)
        dups = [m for m in members if m["id"] != canonical["id"]]
        eligible.append((canonical, dups))

    n_dups = sum(len(d) for _, d in eligible)
    print(f"groupes candidats cross-source : {len(groups)}")
    print(f"  → éligibles (même famille, spread<{MAX_SPREAD_M:.0f}m) : {len(eligible)} groupes, {n_dups} doublons")
    print(f"  → cross-famille (reportés, NON fusionnés) : {cross_family}")
    print(f"  → spread trop large (skippés) : {spread_skip}")

    if not args.apply:
        print("\n[DRY-RUN] aucune écriture. Exemples (canonique ← doublons) :")
        for canonical, dups in eligible[:12]:
            srcs = "+".join(sorted(d["source"] for d in dups))
            print(f"  garde [{canonical['source']}] {str(canonical['id'])[:8]} ← {len(dups)} ({srcs})")
        return 0

    merged_groups = merged_dups = skipped = 0
    todo = eligible[: args.max_groups] if args.max_groups else eligible
    for canonical, dups in todo:
        safe = [d for d in dups if not has_user_data(cur, d["id"])]
        if not safe:
            continue
        merge_group(conn, canonical, safe)
        merged_groups += 1
        merged_dups += len(safe)
        skipped += len(dups) - len(safe)
        if merged_groups % 50 == 0:
            print(f"  … {merged_groups} groupes fusionnés ({merged_dups} doublons)", flush=True)
    print(f"\n✅ fusionnés : {merged_groups} groupes, {merged_dups} doublons (skippés données-user : {skipped})")

    print("Refresh MV…", flush=True)
    cur.execute("SET statement_timeout='300s'")
    cur.execute("SELECT refresh_venue_facets()")
    cur.execute("SELECT refresh_venue_aggregates()")
    conn.commit()
    print("✅ refresh_venue_facets + refresh_venue_aggregates OK")
    cur.close(); conn.close()
    return 0


# ── Self-test (logique pure, sans réseau) ────────────────────────────────────
def self_test() -> int:
    assert source_rank("overture") < source_rank("hyrox") < source_rank("inconnu")
    assert round(haversine_m(48.85, 2.35, 48.85, 2.35)) == 0
    assert 50 < haversine_m(48.8500, 2.3500, 48.8500, 2.3508) < 70  # ~58m / 0.0008°lon @48.85°
    # canonique : enrichi prioritaire
    a = {"id": "a", "source": "osm", "has_enr": False, "sport_count": 1, "created_at": 1}
    b = {"id": "b", "source": "hyrox", "has_enr": True, "sport_count": 1, "created_at": 2}
    assert pick_canonical([a, b])["id"] == "b"
    # à enrichissement égal : plus de sports gagne
    a2 = {"id": "a", "source": "osm", "has_enr": False, "sport_count": 3, "created_at": 1}
    b2 = {"id": "b", "source": "osm", "has_enr": False, "sport_count": 1, "created_at": 2}
    assert pick_canonical([a2, b2])["id"] == "a"
    # priorité source à égalité
    a3 = {"id": "a", "source": "hyrox", "has_enr": False, "sport_count": 1, "created_at": 1}
    b3 = {"id": "b", "source": "overture", "has_enr": False, "sport_count": 1, "created_at": 1}
    assert pick_canonical([a3, b3])["id"] == "b"
    print("✓ dedup_venues self-test OK")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Dédup cross-source des venues (#463)")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (défaut : dry-run)")
    p.add_argument("--max-groups", type=int, default=None, help="Limite (lot pilote)")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
