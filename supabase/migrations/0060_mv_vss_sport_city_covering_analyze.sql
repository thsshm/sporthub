-- ════════════════════════════════════════════════════════════════════════
-- Migration 0060 : index COUVRANT (sport_slug, city_id, venue_id) + ANALYZE
-- ════════════════════════════════════════════════════════════════════════
-- Suite de 0058. Le bug gym×ville persistait pour la PLUS GROSSE ville
-- (gym×Paris, 890 venues) : page vide alors que les autres villes marchent.
--
-- Deux causes, traitées ici :
--
-- 1. **Pas d'ANALYZE après 0058** : `CREATE INDEX` seul ne rafraîchit pas
--    suffisamment les stats du planner → il continuait d'ignorer
--    `idx_mv_vss_sport_city` et de scanner ~140k lignes du sport via
--    `idx_mv_vss_sport_quality_vid`. Mesuré : le COUNT exact mettait ~0.2s côté
--    service_role (au lieu de ~5ms en index-only). Sous le rôle **anon** (celui
--    de la page, getSupabaseServerClient = clé anon, statement_timeout court) ce
--    scan dépassait le timeout → erreur → `getVisibleVenueCount` retourne 0 →
--    page vide. Seule la plus grosse ville franchissait le seuil.
--
-- 2. **Index non couvrant pour le scope** : `fetchScopeVenues` fait
--    `WHERE sport_slug=$ AND city_id=$ ORDER BY venue_id LIMIT 1000`. L'index 2
--    colonnes de 0058 ne porte pas `venue_id` → le planner repassait sur l'index
--    PK `(venue_id, sport_slug)` ordonné par venue_id et filtrait en ligne (gros
--    scan) au lieu d'un parcours index ordonné. Même schéma que la liste
--    nationale, qui utilise `(sport_slug, quality_score, venue_id)` pour cette
--    raison exacte.
--
-- Fix : un seul index COUVRANT `(sport_slug, city_id, venue_id)` — sert à la
-- fois le COUNT (préfixe sport_slug, city_id) et le scope ordonné par venue_id.
-- Remplace celui de 0058 (devenu redondant). + ANALYZE pour que le planner
-- l'adopte immédiatement.
-- ════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_mv_vss_sport_city;

CREATE INDEX IF NOT EXISTS idx_mv_vss_sport_city_vid
  ON mv_venue_sport_search (sport_slug, city_id, venue_id);

ANALYZE mv_venue_sport_search;
