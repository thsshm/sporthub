-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0046 : index composite pour venues_facets_in_bbox
-- ════════════════════════════════════════════════════════════════════════
-- Issue #410 : venues_facets_in_bbox timeoute à froid pour le rôle anon
-- (statement_timeout = 3 s Supabase) sur les zones denses (Paris ~6 s).
--
-- Analyse de la requête lente :
--   La RPC fait un CTE MATERIALIZED sur ~370k venues (filtré geom && bbox +
--   is_published + deleted_at), puis 3 GROUP BY pour les facettes
--   famille/critères/surfaces. Le goulot est le **JOIN venue_sport** pour les
--   surfaces (O(venues_in_bbox × mean_sports_per_venue)) et le scan des
--   colonnes de critères (has_lighting, is_indoor, …) sur chaque venue.
--
-- Fix — deux index partiels (venues publiées, non supprimées) :
--
--   1. idx_venue_facets_criteria : index covering sur les colonnes de critères
--      (family_slug, has_lighting, is_indoor, is_wheelchair_accessible,
--      fee_required). Élimine l'accès heap pour les GROUP BY famille+critères
--      une fois que geom a présélectionné le sous-ensemble spatial.
--      INCLUDE(id) pour le CROSS JOIN LATERAL.
--
--   2. idx_venue_sport_facets : index sur venue_sport(venue_id, surface)
--      pour le GROUP BY surfaces — le JOIN faisait un seq scan de venue_sport
--      (~400k lignes) pour filtrer sur venue_id IN (sous-ensemble bbox).
--
-- Impact attendu : les deux groupes lents (critères + surfaces) passent d'un
-- heap scan à un index scan → 3–5× plus rapide sur Paris à froid.
-- La dimension famille était déjà rapide (family_slug est indexée via
-- idx_venue_family_published).
--
-- ⚠️ INDEX CONCURRENTLY → à appliquer via le SQL Editor Supabase
--    (CONCURRENTLY interdit dans une transaction — cf. 0009 + CLAUDE.md).
--    Copier-coller dans Supabase Dashboard → SQL Editor → Run.
--    Versionné ici pour traçabilité ; pas re-rejoué par la CLI car déjà
--    créé en prod.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Index covering pour les facettes famille + critères.
--    Filtre partiel identique à idx_venue_geom_published (0009) :
--    le planner peut les combiner via Bitmap AND.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venue_facets_criteria
  ON venue (family_slug, has_lighting, is_indoor, is_wheelchair_accessible, fee_required)
  INCLUDE (id)
  WHERE is_published = TRUE AND deleted_at IS NULL;

-- 2. Index pour le JOIN venue_sport sur les surfaces.
--    Covering (venue_id, surface) élimine l'accès heap pour la dimension surface.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venue_sport_facets
  ON venue_sport (venue_id, surface)
  WHERE surface IS NOT NULL;

COMMENT ON INDEX idx_venue_facets_criteria IS
  'Covering index for venues_facets_in_bbox family+criteria GROUP BY (#410). '
  'Applied out-of-transaction via SQL Editor (CONCURRENTLY).';

COMMENT ON INDEX idx_venue_sport_facets IS
  'Index for venues_facets_in_bbox surface JOIN (#410). '
  'Applied out-of-transaction via SQL Editor (CONCURRENTLY).';
