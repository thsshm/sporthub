#!/usr/bin/env python3
"""reload_postgrest.py — force PostgREST à recharger son cache de schéma.

Incident 2026-06 : PostgREST renvoie `PGRST002` (« Could not query the database
for the schema cache. Retrying. ») de façon persistante → toutes les RPC
échouent → `/api/venues` = 500 → carte vide. La base Postgres elle-même est
saine (les migrations CLI se connectent sans souci) ; c'est le cache de schéma
de PostgREST qui est coincé.

Le fix officiel Supabase : envoyer `NOTIFY pgrst, 'reload schema'` sur la base.
PostgREST écoute le canal `pgrst` et reconstruit son cache à réception.

Non destructif (juste un NOTIFY). Connexion Postgres directe (pooler session),
même pattern que import_wikidata_retreats.py. Secret : SUPABASE_DB_PASSWORD.
"""
from __future__ import annotations

import os
import sys


def main() -> int:
    pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if not pw:
        print("❌ SUPABASE_DB_PASSWORD manquant.", file=sys.stderr)
        return 1
    import psycopg2

    conn = psycopg2.connect(
        host=os.environ.get("SUPABASE_DB_HOST", "aws-0-eu-west-3.pooler.supabase.com"),
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        user=os.environ.get("SUPABASE_DB_USER", "postgres.qwfvcrisfmnrfzsrnjwn"),
        password=pw,
        dbname="postgres",
        sslmode="require",
        connect_timeout=20,
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("NOTIFY pgrst, 'reload schema';")
    cur.execute("NOTIFY pgrst, 'reload config';")
    cur.close()
    conn.close()
    print("✅ NOTIFY pgrst 'reload schema' + 'reload config' envoyés.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
