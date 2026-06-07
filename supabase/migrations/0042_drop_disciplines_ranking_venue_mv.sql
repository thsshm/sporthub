-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0042 : drop de l'ancien classement disciplines (#389)
-- ════════════════════════════════════════════════════════════════════════
-- Depuis #385 (migration 0038), /disciplines/* classe PAR CLUB via
-- `mv_top_clubs_by_sport` / RPC `top_clubs_by_sport`. Les objets venue-based de
-- #358/0034 (puis 0035) ne sont plus référencés par aucune page (vérifié) :
--   - MV `mv_disciplines_ranking`
--   - RPC `top_discipline_venues(TEXT, INTEGER)`
--   - fonction de refresh `refresh_disciplines_ranking_mv()`
-- On les supprime. Le cron `/api/cron/refresh-disciplines` (qui appelait la
-- fonction de refresh) est retiré dans la même PR (route + vercel.json).
--
-- Ordre : le RPC SQL dépend de la MV → droper RPC + fonctions avant la MV.
-- Les index de la MV tombent avec elle.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS refresh_disciplines_ranking_mv();
DROP FUNCTION IF EXISTS top_discipline_venues(TEXT, INTEGER);
DROP MATERIALIZED VIEW IF EXISTS mv_disciplines_ranking;
