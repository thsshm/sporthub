#!/usr/bin/env bash
#
# finish-deploy.sh — orchestration des étapes ops post-merge (à lancer par Gautier).
#
# Enchaîne, avec confirmation avant chaque écriture :
#   1. supabase db push  (applique les migrations en attente : 0011, 0012, …)
#   2. regen lib/supabase/types.ts  (vire les casts temporaires venues_clustered / clubs)
#   3. cluster_clubs.py  (peuple venue.club_id — dry-run puis réel)
#
# Pré-requis dans .env.local (jamais commité) :
#   SUPABASE_ACCESS_TOKEN=sbp_xxx        # https://supabase.com/dashboard/account/tokens
#   SUPABASE_DB_PASSWORD=xxx             # mot de passe Postgres du projet
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...     # pour cluster_clubs.py
#
# À lancer depuis la racine du repo principal :
#   cd ~/Projects/sporthub && ./scripts/finish-deploy.sh
#
# ⚠️ N'applique RIEN sans confirmation explicite (y/N) à chaque étape qui écrit.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Couleurs ──────────────────────────────────────────────────────────────
bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✅ %s\033[0m\n" "$1"; }
warn() { printf "\033[33m⚠️  %s\033[0m\n" "$1"; }
err()  { printf "\033[31m❌ %s\033[0m\n" "$1"; }

confirm() {
  # confirm "message" → retourne 0 si y/Y, 1 sinon
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# ── Charger .env.local ────────────────────────────────────────────────────
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
else
  err ".env.local introuvable à la racine du repo."
  exit 1
fi

# ── Vérifs préalables ─────────────────────────────────────────────────────
if ! command -v supabase >/dev/null 2>&1; then
  err "supabase CLI introuvable. Install : brew install supabase/tap/supabase"
  exit 1
fi
: "${SUPABASE_ACCESS_TOKEN:?manquant dans .env.local}"
: "${SUPABASE_DB_PASSWORD:?manquant dans .env.local}"

echo
bold "═══════════════════════════════════════════════════════════════"
bold " finish-deploy.sh — ops post-merge SportHub V2"
bold "═══════════════════════════════════════════════════════════════"
echo "Branche courante : $(git rev-parse --abbrev-ref HEAD)"
echo "Assure-toi d'être sur 'main' à jour (git pull) avant de continuer."
echo
confirm "Continuer ?" || { echo "Abandon."; exit 0; }

# ── Étape 1 : migrations ───────────────────────────────────────────────────
echo
bold "── Étape 1/3 : migrations Supabase ─────────────────────────────"
echo "Dry-run (lecture seule) des migrations en attente…"
supabase db push --dry-run --linked

echo
warn "Si une migration utilise CREATE INDEX CONCURRENTLY, le push va échouer"
warn "(transaction). Dans ce cas : applique-la à la main dans le SQL Editor,"
warn "puis relance ce script — elle sera marquée comme déjà appliquée."
echo
if confirm "Appliquer ces migrations en PROD ?"; then
  supabase db push --linked
  ok "Migrations appliquées."
else
  warn "Migrations sautées."
fi

# ── Étape 2 : regen des types ──────────────────────────────────────────────
echo
bold "── Étape 2/3 : régénération lib/supabase/types.ts ──────────────"
if confirm "Régénérer les types depuis le schéma prod ?"; then
  supabase gen types typescript --linked > lib/supabase/types.ts
  ok "Types régénérés. Pense à : pnpm typecheck && git add lib/supabase/types.ts && git commit"
  echo "   (les casts temporaires venues_clustered / clubs peuvent maintenant sauter)"
else
  warn "Regen sautée."
fi

# ── Étape 3 : clustering des clubs ─────────────────────────────────────────
echo
bold "── Étape 3/3 : peupler venue.club_id (cluster_clubs.py) ────────"
if [[ ! -f scripts/cluster_clubs.py ]]; then
  warn "scripts/cluster_clubs.py absent (PR #197 pas encore mergée ?). Étape sautée."
else
  : "${SUPABASE_URL:?manquant dans .env.local pour cluster_clubs.py}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?manquant dans .env.local pour cluster_clubs.py}"
  echo "Dry-run du clustering (aucune écriture)…"
  python3 scripts/cluster_clubs.py --dry-run \
    --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"
  echo
  if confirm "Lancer le clustering RÉEL (écrit venue.club_id) ?"; then
    python3 scripts/cluster_clubs.py --no-dry-run \
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"
    ok "Clusters peuplés."
  else
    warn "Clustering réel sauté (dry-run seulement)."
  fi
fi

echo
bold "═══════════════════════════════════════════════════════════════"
ok "finish-deploy.sh terminé."
echo "Vérifs conseillées :"
echo "  • supabase migration list --linked   (local == remote ?)"
echo "  • pnpm typecheck                      (si types régénérés)"
echo "  • secrets Vercel/Supabase encore à poser : SENTRY_DSN, CRON_SECRET, Google OAuth"
bold "═══════════════════════════════════════════════════════════════"
