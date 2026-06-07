-- ════════════════════════════════════════════════════════════════════════
-- Migration 0039 : vues matérialisées pour les agrégats carte (#387)
-- ════════════════════════════════════════════════════════════════════════
-- venues_aggregates agrégeait en LIVE sur venue (267k+) → statement_timeout
-- (57014) au dézoom → vue monde/pays/région cassée. On précalcule les agrégats
-- dans 2 MV ; le RPC (migration 0040) lira ces MV au lieu de scanner venue.
--
-- Dimensions famille / sport / retraite conservées pour respecter les filtres
-- de venues_aggregates. Centroïde stocké en SUM(lat)/SUM(lon)/n → le RPC fait
-- le centroïde pondéré après agrégation des dimensions filtrées.
--
-- Cette migration est ADDITIVE : elle ne touche pas encore le RPC (0040).
-- ════════════════════════════════════════════════════════════════════════

-- ── MV 1 : agrégats par pays (zoom < 6) ─────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_country_agg AS
SELECT
  v.country_code,
  v.family_slug,
  COALESCE(v.primary_sport_slug, '') AS primary_sport_slug,
  (v.retreat_type IS NOT NULL)       AS is_retreat,
  COUNT(*)::bigint                   AS n,
  SUM(v.lat)::double precision       AS sum_lat,
  SUM(v.lon)::double precision       AS sum_lon
FROM venue v
WHERE v.is_published = TRUE
  AND v.deleted_at IS NULL
  AND v.country_code IS NOT NULL
GROUP BY v.country_code, v.family_slug,
         COALESCE(v.primary_sport_slug, ''), (v.retreat_type IS NOT NULL);

-- UNIQUE → autorise REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_country_agg_pk
  ON mv_venue_country_agg (country_code, family_slug, primary_sport_slug, is_retreat);

-- ── MV 2 : agrégats par cellule de grille (zoom 6-9, 4 tailles) ─────────────
-- cell_x/cell_y pré-calculés en web-mercator (EPSG:3857), comme 0025.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_grid_agg AS
SELECT
  g.grid_size_m,
  FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_x,
  FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_y,
  v.family_slug,
  COALESCE(v.primary_sport_slug, '') AS primary_sport_slug,
  (v.retreat_type IS NOT NULL)       AS is_retreat,
  COUNT(*)::bigint                   AS n,
  SUM(v.lat)::double precision       AS sum_lat,
  SUM(v.lon)::double precision       AS sum_lon
FROM venue v
CROSS JOIN (VALUES
  (500000.0::double precision),  -- zoom ≤ 6
  (200000.0::double precision),  -- zoom 7
  (100000.0::double precision),  -- zoom 8
  ( 50000.0::double precision)   -- zoom 9
) AS g(grid_size_m)
WHERE v.is_published = TRUE
  AND v.deleted_at IS NULL
GROUP BY g.grid_size_m,
  FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / g.grid_size_m),
  FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / g.grid_size_m),
  v.family_slug, COALESCE(v.primary_sport_slug, ''), (v.retreat_type IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_grid_agg_pk
  ON mv_venue_grid_agg (grid_size_m, cell_x, cell_y, family_slug, primary_sport_slug, is_retreat);

-- Lecture publique (les MV ne contiennent que des comptes agrégés, rien de privé).
GRANT SELECT ON mv_venue_country_agg TO anon, authenticated;
GRANT SELECT ON mv_venue_grid_agg    TO anon, authenticated;

-- ── Refresh helper (appelé par un cron — cf. 0040 / app/api/cron) ───────────
CREATE OR REPLACE FUNCTION refresh_venue_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_venue_country_agg;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_venue_grid_agg;
END;
$$;
