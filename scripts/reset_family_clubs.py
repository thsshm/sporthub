#!/usr/bin/env python3
"""reset_family_clubs.py — vide les clubs d'une famille, résistant aux locks.

Contexte (#497 / migration 0061) : avant de re-clusteriser une famille avec les
noms corrigés (#567), il faut détacher les venues de leurs clubs actuels puis
supprimer ces clubs. L'approche via PostgREST (`cluster_clubs.py --reset`) fait
un `UPDATE venue SET club_id=NULL WHERE club_id IN (…)` par gros lots : sous la
contention de locks des imports concurrents sur `venue`, le statement attend les
verrous et tombe en `57014 statement timeout` — échec systématique dès le 1er lot
(constaté 3× en prod, 2026-06).

Ce script contourne le problème par une **connexion Postgres directe** (pooler),
ce qui permet de poser un `lock_timeout` COURT : au lieu d'attendre un verrou
tenu par un import concurrent, le statement échoue vite (`55P03`) et on le rejoue
après un petit backoff. Combiné à de **petits lots keyset** (par `venue.id`, donc
pas de scan sparse), chaque transaction est brève, commit tôt, relâche ses
verrous et se faufile entre les écritures concurrentes.

Étapes :
  1. Détache les venues : `UPDATE venue SET club_id=NULL WHERE id IN (
       SELECT v.id FROM venue v JOIN club c ON v.club_id=c.id
       WHERE c.family_slug=%s LIMIT <batch>)` en boucle jusqu'à 0 ligne.
  2. Supprime les clubs orphelins : `DELETE FROM club WHERE family_slug=%s`
     par lots d'`id`.
  3. `NOTIFY pgrst, 'reload schema'` (par prudence, comme reload_postgrest.py).

Idempotent. `--dry-run` : compte seulement, n'écrit rien.
Secret requis : SUPABASE_DB_PASSWORD (connexion directe, ≠ service-role REST).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

# Codes Postgres qu'on rejoue : verrou indisponible / statement annulé (timeout).
RETRYABLE = {"55P03", "57014"}


def _connect(pw: str):
    import psycopg2

    return psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw,
        dbname="postgres",
        sslmode="require",
        connect_timeout=20,
    )


def _exec_with_retry(conn, sql: str, params: tuple, *, max_attempts: int = 12) -> int:
    """Exécute un statement écrivain, rejoue sur lock/timeout. Renvoie rowcount."""
    import psycopg2

    attempt = 0
    while True:
        attempt += 1
        try:
            with conn.cursor() as cur:
                # lock_timeout court : on n'attend pas un verrou tenu par un import.
                cur.execute("SET LOCAL lock_timeout = '4s'; SET LOCAL statement_timeout = '30s';")
                cur.execute(sql, params)
                n = cur.rowcount
            conn.commit()
            return n
        except psycopg2.Error as e:  # noqa: PERF203
            conn.rollback()
            code = getattr(e, "pgcode", None)
            if code in RETRYABLE and attempt < max_attempts:
                wait = min(2.0 * attempt, 15.0)
                log.warning("  lot rejoué (pgcode=%s, tentative %d) après %.0fs…", code, attempt, wait)
                time.sleep(wait)
                continue
            raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--family", default="raquette", help="family_slug à réinitialiser (défaut: raquette)")
    ap.add_argument("--batch", type=int, default=400, help="taille de lot venues (défaut: 400)")
    ap.add_argument("--dry-run", action="store_true", help="compte seulement, n'écrit rien")
    args = ap.parse_args()

    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        log.error("SUPABASE_DB_PASSWORD manquant.")
        return 1

    conn = _connect(pw)
    fam = args.family
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM venue v JOIN club c ON v.club_id=c.id WHERE c.family_slug=%s", (fam,)
            )
            n_linked = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM club WHERE family_slug=%s", (fam,))
            n_clubs = cur.fetchone()[0]
        conn.commit()
        log.info("Famille '%s' : %d venues liées, %d clubs.", fam, n_linked, n_clubs)

        if args.dry_run:
            log.info("[dry-run] détacherait %d venues puis supprimerait %d clubs. Aucune écriture.", n_linked, n_clubs)
            return 0

        # 1) Détache les venues, petits lots keyset, jusqu'à épuisement.
        detach_sql = (
            "UPDATE venue SET club_id=NULL WHERE id IN ("
            "  SELECT v.id FROM venue v JOIN club c ON v.club_id=c.id"
            "  WHERE c.family_slug=%s LIMIT %s)"
        )
        total_detached = 0
        while True:
            n = _exec_with_retry(conn, detach_sql, (fam, args.batch))
            total_detached += n
            if n:
                log.info("  détachées : %d (cumul %d)", n, total_detached)
            if n < args.batch:
                break
        log.info("Détache terminée : %d venues.", total_detached)

        # 2) Supprime les clubs (désormais sans venue), par lots d'id.
        del_sql = (
            "DELETE FROM club WHERE id IN ("
            "  SELECT id FROM club WHERE family_slug=%s LIMIT %s)"
        )
        total_deleted = 0
        while True:
            n = _exec_with_retry(conn, del_sql, (fam, args.batch))
            total_deleted += n
            if n:
                log.info("  clubs supprimés : %d (cumul %d)", n, total_deleted)
            if n < args.batch:
                break
        log.info("Suppression terminée : %d clubs.", total_deleted)

        # 3) Reload PostgREST par prudence (le schéma n'a pas changé mais sans coût).
        with conn.cursor() as cur:
            cur.execute("NOTIFY pgrst, 'reload schema';")
        conn.commit()

        log.info("✅ Reset '%s' OK : %d venues détachées, %d clubs supprimés.", fam, total_detached, total_deleted)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
