#!/usr/bin/env bash
#
# Push les nouvelles migrations Supabase vers la DB liée (prod).
# Remplace l'ancien scripts/apply_migration.py qui passait par psycopg2 direct.
#
# Workflow recommandé pour ajouter une migration :
#   1. supabase migration new <nom_descriptif>    # → crée supabase/migrations/NNNN_<nom>.sql
#   2. Éditer le SQL généré
#   3. ./scripts/db-push.sh                       # → dry-run + confirm + push
#   4. git add + commit + push                    # → commit la migration dans le repo
#
# Pré-requis (à mettre dans .env.local, jamais commité) :
#   SUPABASE_ACCESS_TOKEN=sbp_xxx     # https://supabase.com/dashboard/account/tokens
#   SUPABASE_DB_PASSWORD=xxx          # mot de passe Postgres du projet
#
# Le script charge automatiquement .env.local s'il existe.

set -euo pipefail

cd "$(dirname "$0")/.."

# ── Charger .env.local si présent ────────────────────────────────────────────
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# ── Vérifications préalables ─────────────────────────────────────────────────
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN manquant."
  echo "   → https://supabase.com/dashboard/account/tokens"
  echo "   → ajouter dans .env.local : SUPABASE_ACCESS_TOKEN=sbp_..."
  exit 1
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "❌ SUPABASE_DB_PASSWORD manquant dans .env.local."
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "❌ supabase CLI introuvable. Install : brew install supabase/tap/supabase"
  exit 1
fi

# ── Dry-run pour montrer ce qui va se passer ─────────────────────────────────
echo "🔍 Dry-run : migrations à appliquer…"
supabase db push --dry-run --linked

echo
read -p "Continuer et appliquer pour de vrai ? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── Push réel ────────────────────────────────────────────────────────────────
echo "🚀 Application des migrations…"
supabase db push --linked

echo "✅ Push terminé. Vérifie avec : supabase migration list --linked"
