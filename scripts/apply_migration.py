#!/usr/bin/env python3
"""
⚠️  DEPRECATED — utiliser `./scripts/db-push.sh` à la place (cf. CLAUDE.md).

Ce script existait avant que le projet Supabase soit linké au repo (workflow
hack via psycopg2). Le nouveau workflow `supabase db push --linked` track la
migration history côté DB, ce qui évite les divergences code ↔ schéma.

Gardé pour référence et fallback si le CLI Supabase n'est pas dispo.

Usage (legacy) :
  python3 scripts/apply_migration.py supabase/migrations/0007_xxx.sql

Requiert dans .env.local :
  NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_DB_PASSWORD=<password>
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_FILE.exists():
        sys.exit(f"❌ {ENV_FILE} introuvable.")
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit("Usage: apply_migration.py <path/to/migration.sql>")
    sql_path = Path(sys.argv[1])
    if not sql_path.exists():
        sys.exit(f"❌ {sql_path} introuvable.")

    env = load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    pwd = env.get("SUPABASE_DB_PASSWORD", "")
    if not url or not pwd:
        sys.exit("❌ Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_DB_PASSWORD")

    ref = urlparse(url).hostname.split(".")[0]  # qwfvcrisfmnrfzsrnjwn
    sql = sql_path.read_text()

    candidates = [
        # Pooler (transaction mode) — IPv4 friendly
        dict(host=f"aws-0-eu-central-1.pooler.supabase.com", port=6543,
             user=f"postgres.{ref}", password=pwd, dbname="postgres", sslmode="require"),
        # Direct connection
        dict(host=f"db.{ref}.supabase.co", port=5432,
             user="postgres", password=pwd, dbname="postgres", sslmode="require"),
    ]

    last_err: Exception | None = None
    for params in candidates:
        try:
            print(f"→ Tentative {params['host']}:{params['port']} …")
            conn = psycopg2.connect(**params)
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.close()
            print(f"✅ Migration appliquée : {sql_path.name}")
            return 0
        except Exception as e:
            print(f"  ↳ échec : {e}")
            last_err = e

    print(f"❌ Aucune connexion n'a abouti. Dernière erreur : {last_err}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
