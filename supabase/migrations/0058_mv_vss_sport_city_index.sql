-- ════════════════════════════════════════════════════════════════════════
-- Migration 0058 : index (sport_slug, city_id) sur mv_venue_sport_search
-- ════════════════════════════════════════════════════════════════════════
-- BUG (prod, diagnostic 2026-06-11) : les pages sport×ville du PLUS GROS sport
-- (gym, ~140k venues) s'affichaient VIDES (« No address », compteur 0) alors
-- que la data est bien présente (855 gym à Paris dans `venue`, 890 dans la MV).
--
-- Cause : `getVisibleVenueCount` (lib/venue/visible-count.ts) fait un
-- `count: 'exact'` sur `mv_venue_sport_search WHERE sport_slug=$1 AND city_id=$2`.
-- La MV (0056) n'a d'index QUE sur (sport_slug, quality_score, venue_id) et
-- (sport_slug, geom) — AUCUN sur city_id. Le COUNT(*) exact doit donc scanner
-- TOUTES les lignes du sport pour filtrer city_id. Trivial pour tennis/yoga,
-- mais sur gym (140k) ça dépasse le statement_timeout → PostgREST renvoie une
-- erreur → `getVisibleVenueCount` retourne 0 (catch silencieux) → page vide.
-- Seul gym était touché (le seul assez gros pour timeouter) ; le commentaire de
-- la page supposait l'index (primary_sport_slug, city_id) de la table `venue`
-- (0005), mais #556 a rerouté le compteur vers la MV, qui ne l'a pas.
--
-- Fix : index composite (sport_slug, city_id). Le COUNT(*) borné par ville
-- redevient index-only et instantané, et la requête de scope
-- (fetchScopeVenues : eq sport_slug + eq city_id) en profite aussi.
--
-- Pas de CONCURRENTLY (interdit en transaction db-push, cf. CLAUDE.md) : la MV
-- n'est écrite que par le refresh hebdo, un build d'index non concurrent (~qq s)
-- est sans impact utilisateur. Pas de refresh nécessaire (data déjà présente).
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_mv_vss_sport_city
  ON mv_venue_sport_search (sport_slug, city_id);
