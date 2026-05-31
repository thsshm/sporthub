#!/usr/bin/env bash
#
# deploy-225.sh — déploiement assisté de la PR #225 (drop service_role du chemin public).
#
# ⚠️ ORDRE INVERSÉ : la migration 0015 doit être appliquée AVANT le merge.
#    Le code de la PR appelle les RPC avec le client anon ; ces RPC ne sont
#    SECURITY DEFINER + GRANT anon qu'une fois 0015 appliquée. Merger avant
#    d'appliquer 0015 réintroduit le statement_timeout sur le /map public.
#
# Usage :
#   ./scripts/deploy-225.sh <PREVIEW_URL>
#   ex : ./scripts/deploy-225.sh https://sporthub-git-feat-225-...vercel.app
#
# Le script :
#   1. Affiche le SQL de 0015 (depuis la branche PR) à coller dans le SQL Editor
#   2. Attend ta confirmation que c'est appliqué
#   3. Lance les curl de vérif contre la preview (dense / peu dense / clubs)
#   4. Rappelle l'ordre merge + regen types

set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="feat/225-drop-service-role-public"
MIGRATION="supabase/migrations/0015_security_definer_public_rpc.sql"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✅ %s\033[0m\n" "$1"; }
ko()   { printf "\033[31m❌ %s\033[0m\n" "$1"; }
warn() { printf "\033[33m⚠️  %s\033[0m\n" "$1"; }

PREVIEW="${1:-}"
if [[ -z "$PREVIEW" ]]; then
  ko "Usage : ./scripts/deploy-225.sh <PREVIEW_URL>"
  echo "   (l'URL de preview Vercel de la PR #235)"
  exit 1
fi
PREVIEW="${PREVIEW%/}"  # strip trailing slash

# ── Étape 1 : afficher le SQL de la migration 0015 ─────────────────────────
bold "═══════════════════════════════════════════════════════════════"
bold " Étape 1/3 — Appliquer la migration 0015 (AVANT le merge)"
bold "═══════════════════════════════════════════════════════════════"
echo "Récupération du SQL depuis la branche $BRANCH…"
git fetch origin "$BRANCH" --quiet 2>/dev/null || warn "fetch branche échoué (déjà en local ?)"
echo
echo "────────── COPIE CE SQL DANS Supabase Dashboard → SQL Editor ──────────"
git show "origin/$BRANCH:$MIGRATION" 2>/dev/null || git show "$BRANCH:$MIGRATION"
echo "───────────────────────────────────────────────────────────────────────"
echo
warn "Transactionnel (pas de CONCURRENTLY) → passe d'un coup dans le SQL Editor."
read -r -p "0015 appliquée en prod ? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || { warn "Stop. Applique 0015 puis relance."; exit 0; }

# ── Étape 2 : vérif curl contre la preview ─────────────────────────────────
echo
bold "═══════════════════════════════════════════════════════════════"
bold " Étape 2/3 — Vérif de la preview : $PREVIEW"
bold "═══════════════════════════════════════════════════════════════"

# check_bbox <label> <path> <bbox> [extra_qs]
check_bbox() {
  local label="$1" path="$2" bbox="$3" extra="${4:-}"
  local url="${PREVIEW}${path}?bbox=${bbox}${extra}"
  local out http time body
  out=$(curl -s -w '\n%{http_code} %{time_total}' --max-time 15 "$url" 2>/dev/null) || { ko "$label : curl a échoué"; return 1; }
  http=$(echo "$out" | tail -1 | cut -d' ' -f1)
  time=$(echo "$out" | tail -1 | cut -d' ' -f2)
  body=$(echo "$out" | sed '$d')
  if [[ "$http" != "200" ]]; then
    ko "$label : HTTP $http (${time}s) — $url"
    return 1
  fi
  # compte d'items dans la réponse (venues/clubs/cells)
  local n
  n=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('venues',d.get('clubs',d.get('cells',[])))))" 2>/dev/null || echo "?")
  ok "$label : HTTP 200 en ${time}s — ${n} items"
}

bold "→ Région DENSE (Paris) — doit répondre vite, beaucoup d'items"
check_bbox "venues Paris   " "/api/venues"       "2.20,48.78,2.55,48.95" "&zoom=13" || true
check_bbox "clubs  Paris   " "/api/venues/clubs" "2.20,48.78,2.55,48.95"           || true

echo
bold "→ Région PEU DENSE (Atlantique) — le test clé : NE DOIT PLUS timeout"
check_bbox "venues Atlantiq" "/api/venues"       "-40,30,-20,45" "&zoom=6" || true
check_bbox "clubs  Atlantiq" "/api/venues/clubs" "-40,30,-20,45"           || true

echo
warn "Vérif manuelle anti-fuite (à l'œil) : aucun venue non-publié/soft-deleted"
echo "   curl -s '${PREVIEW}/api/venues?bbox=2.20,48.78,2.55,48.95&zoom=13' | python3 -m json.tool | head"

# ── Étape 3 : rappel ordre merge + types ───────────────────────────────────
echo
bold "═══════════════════════════════════════════════════════════════"
bold " Étape 3/3 — Si tout est vert ci-dessus :"
bold "═══════════════════════════════════════════════════════════════"
echo "  1. Merge #235 (le code anon trouvera les RPC déjà en SECURITY DEFINER)"
echo "  2. ./scripts/db-push.sh  → 0015 déjà appliquée = marquée, no-op"
echo "  3. supabase gen types typescript --linked > lib/supabase/types.ts"
echo "     → retire les casts temporaires clubs_in_bbox / venues_* (commit séparé)"
echo
ok "deploy-225.sh terminé."
