-- ════════════════════════════════════════════════════════════════════════
-- Migration 0056 : mv_venue_sport_search + quality_score & city dénormalisés (#476)
-- ════════════════════════════════════════════════════════════════════════
-- Permet à la liste SSR /sports/[sport] d'interroger la MV EN DIRECT (PostgREST,
-- count:'planned' instantané) au lieu d'un RPC à COUNT(*) OVER() qui timeoutait
-- sur gym (174k). On dénormalise donc quality_score (#464, filtre liste) + le nom
-- de ville (l'embed city via FK est impossible sur une MV).
--
-- Rebuild (DROP+CREATE) car on ajoute des colonnes. mv_venue_sport_grid_agg
-- dépend de la MV → drop d'abord, recreate ensuite (identique à 0054).
-- venues_in_bbox / venues_aggregates référencent les MV par NOM (résolu au
-- runtime) → pas de dépendance dure, OK dans la transaction.
-- ════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_venue_sport_grid_agg;
DROP MATERIALIZED VIEW IF EXISTS mv_venue_sport_search;
DROP FUNCTION IF EXISTS venues_by_sport_list(
  TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, INTEGER);

CREATE MATERIALIZED VIEW mv_venue_sport_search AS
SELECT
  v.id AS venue_id, s.sport_slug, v.geom, v.lat, v.lon, v.slug, v.name,
  v.family_slug, v.primary_sport_slug, v.club_id,
  v.is_indoor, v.has_lighting, v.is_wheelchair_accessible, v.fee_required,
  v.address, v.courts_count, v.country_code, v.city_id,
  v.quality_score,
  c.name         AS city_name,
  c.country_code AS city_country
FROM venue v
LEFT JOIN city c ON c.id = v.city_id
CROSS JOIN LATERAL (
  SELECT DISTINCT sport_slug FROM (
    SELECT v.primary_sport_slug AS sport_slug
    UNION
    SELECT vs.sport_slug FROM venue_sport vs WHERE vs.venue_id = v.id
  ) u WHERE sport_slug IS NOT NULL
) s
WHERE v.is_published = TRUE AND v.deleted_at IS NULL;

CREATE UNIQUE INDEX idx_mv_vss_pk ON mv_venue_sport_search (venue_id, sport_slug);
CREATE INDEX idx_mv_vss_sport_geom ON mv_venue_sport_search USING gist (sport_slug, geom);
-- Pagination liste : `sport_slug=X [AND quality_score>=t] ORDER BY venue_id`.
CREATE INDEX idx_mv_vss_sport_quality_vid
  ON mv_venue_sport_search (sport_slug, quality_score, venue_id);

GRANT SELECT ON mv_venue_sport_search TO anon, authenticated;

-- Grille × sport (inchangée vs 0054, reconstruite depuis la MV).
CREATE MATERIALIZED VIEW mv_venue_sport_grid_agg AS
SELECT
  g.grid_size_m,
  FLOOR(ST_X(ST_Transform(m.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_x,
  FLOOR(ST_Y(ST_Transform(m.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_y,
  m.sport_slug,
  COUNT(*)::bigint            AS n,
  SUM(m.lat)::double precision AS sum_lat,
  SUM(m.lon)::double precision AS sum_lon
FROM mv_venue_sport_search m
CROSS JOIN (VALUES (500000.0), (200000.0), (100000.0), (50000.0)) AS g(grid_size_m)
GROUP BY g.grid_size_m, cell_x, cell_y, m.sport_slug;

CREATE UNIQUE INDEX idx_mv_vsga_pk
  ON mv_venue_sport_grid_agg (grid_size_m, cell_x, cell_y, sport_slug);
GRANT SELECT ON mv_venue_sport_grid_agg TO anon, authenticated;
