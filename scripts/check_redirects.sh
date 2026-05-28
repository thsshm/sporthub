#!/usr/bin/env bash
# Vérifie que les redirects 301 V1 → V2 fonctionnent sur un déploiement donné.
#
# Usage :
#   ./scripts/check_redirects.sh https://sporthubmap.com
#   ./scripts/check_redirects.sh https://sporthub-git-main-gautier-ths.vercel.app
#
# Avant le cutover DNS : tester sur l'URL Vercel directe.
# Après le cutover : tester sur sporthubmap.com (avec sporthubmap.com déjà sur Vercel).

set -euo pipefail

BASE="${1:-https://sporthubmap.com}"
PASS=0
FAIL=0

check() {
  local from="$1"
  local expected_to="$2"
  local actual
  actual=$(curl -sI -o /dev/null -w "%{http_code} %{redirect_url}" "${BASE}${from}")
  local code="${actual%% *}"
  local loc="${actual#* }"
  # Normalize : strip base url, strip trailing slash
  loc="${loc#${BASE}}"
  loc="${loc%/}"
  expected_to="${expected_to%/}"
  if [[ "$code" == "308" || "$code" == "301" ]] && [[ "$loc" == "$expected_to" ]]; then
    echo "✓ $from → $loc ($code)"
    PASS=$((PASS+1))
  else
    echo "✗ $from → got $code → '$loc' (expected '$expected_to')"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Pattern family-* ==="
check "/family-raquette.html" "/sports/raquette"
check "/family-glisse.html" "/sports/glisse"
check "/family-yoga.html" "/sports/yoga"

echo ""
echo "=== Pattern sport-ville (slugs identiques) ==="
check "/padel-paris.html" "/padel/fr/paris"
check "/tennis-lyon.html" "/tennis/fr/lyon"
check "/yoga-paris.html" "/yoga/fr/paris"
check "/petanque-marseille.html" "/petanque/fr/marseille"

echo ""
echo "=== Pattern sport-ville (slugs remappés) ==="
check "/boxe-paris.html" "/boxing/fr/paris"
check "/salle-de-sport-paris.html" "/gym/fr/paris"

echo ""
echo "=== Statiques ==="
check "/index.html" "/"
check "/academies-de-tennis.html" "/sports/tennis"
check "/villes.html" "/map"
check "/explore.html" "/map"
check "/favoris.html" "/"

echo ""
echo "─────────────────────────────────────"
echo "Résultat : $PASS ✓  /  $FAIL ✗"
exit $((FAIL > 0 ? 1 : 0))
