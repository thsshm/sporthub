-- ════════════════════════════════════════════════════════════════════════
-- Migration 0061 : ANALYZE après REFRESH de mv_venue_sport_search (#556)
-- ════════════════════════════════════════════════════════════════════════
-- COMPLÈTE 0060 : `REFRESH MATERIALIZED VIEW` ne met PAS à jour les statistiques
-- planner de la MV. Or les pages /sports comptent via `count:'planned'`
-- (PostgREST → estimation planner, instantanée, cf. app/[locale]/sports/[sport]).
-- Sans ANALYZE, les estimations sont périmées/fausses après chaque refresh →
-- compteurs incohérents (#556), voire « No venue » sur des sports peuplés si
-- l'estimation filtrée (sport_slug + quality_score) tombe à ~0.
--
-- On ajoute ANALYZE dans la fonction de refresh (rejouée par le cron) + un
-- ANALYZE immédiat pour rafraîchir les stats courantes (post-0060).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_venue_sport_search_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_sport_search;
  REFRESH MATERIALIZED VIEW mv_venue_sport_grid_agg;
  -- Indispensable : REFRESH ne réanalyse pas la MV → count:'planned' fiable.
  ANALYZE mv_venue_sport_search;
  ANALYZE mv_venue_sport_grid_agg;
END;
$$;

-- ANALYZE immédiat (corrige les stats périmées laissées par le refresh de 0060).
ANALYZE mv_venue_sport_search;
ANALYZE mv_venue_sport_grid_agg;
