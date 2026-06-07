-- ════════════════════════════════════════════════════════════════════════
-- Migration 0041 : refresh_venue_aggregates() en REFRESH NON-concurrent (#387)
-- ════════════════════════════════════════════════════════════════════════
-- FIX : la version 0039 utilisait REFRESH MATERIALIZED VIEW CONCURRENTLY DANS
-- une fonction → interdit (CONCURRENTLY ne peut pas s'exécuter dans une
-- transaction/fonction) → la fonction échouerait à l'appel par le cron.
--
-- On passe en REFRESH non-concurrent (comme refresh_disciplines_ranking_mv,
-- #331). Lock AccessExclusive bref pendant le refresh — acceptable au creux
-- (cron hebdo nocturne). Les MV sont petites (≤ ~45k lignes) → refresh rapide.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_venue_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_country_agg;
  REFRESH MATERIALIZED VIEW mv_venue_grid_agg;
END;
$$;
