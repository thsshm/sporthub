-- ════════════════════════════════════════════════════════════════════════
-- Migration 0042 : statement_timeout local pour refresh_venue_aggregates (#387)
-- ════════════════════════════════════════════════════════════════════════
-- Le REFRESH des MV dépasse le statement_timeout court du rôle. On l'élève à
-- 120s au niveau de la fonction (SECURITY DEFINER). REFRESH non-concurrent.
-- (Déjà appliqué en prod ; ce fichier aligne le repo.)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_venue_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_country_agg;
  REFRESH MATERIALIZED VIEW mv_venue_grid_agg;
END;
$$;
