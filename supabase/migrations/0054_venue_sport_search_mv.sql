-- ════════════════════════════════════════════════════════════════════════
-- Migration 0054 : MV dénormalisée venue×sport pour les pages multi-disciplines (#476)
-- ════════════════════════════════════════════════════════════════════════
-- Problème : tout le data-layer filtre sur venue.primary_sport_slug (#332), donc
-- une venue multi-sport n'apparaît que sur la page de son sport PRIMAIRE. Ex. les
-- ~8 881 box Hyrox (primary=hyrox, venue_sport={hyrox,gym}) absents de /sports/gym.
--
-- Le filtre naïf `primary=sport OR EXISTS(venue_sport)` sur venues_in_bbox mesuré
-- à 1,5-7,5 s (> timeout anon 3 s). On dénormalise donc : 1 ligne par (venue, sport)
-- où sport ∈ ({primary_sport_slug} ∪ venue_sport.sport_slug), indexée spatialement.
--
-- ⚠️ Réservée au CAS SPORT FILTRÉ. Le cas famille/global garde mv_venue_grid_agg
-- (1 venue = 1 ligne) — sinon double-comptage des venues multi-sport.
-- Tout est dans la migration (pas de CONCURRENTLY : index sur MV neuves, 0 lecteur).
-- ════════════════════════════════════════════════════════════════════════

-- Permet l'index GIST composite (scalaire sport_slug + geography geom).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── MV 1 : recherche POI/liste par sport (venue éclatée par son set de sports) ──
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_sport_search AS
SELECT
  v.id            AS venue_id,
  s.sport_slug,
  v.geom,
  v.lat, v.lon, v.slug, v.name,
  v.family_slug, v.primary_sport_slug, v.club_id,
  v.is_indoor, v.has_lighting, v.is_wheelchair_accessible, v.fee_required,
  v.address, v.courts_count, v.country_code, v.city_id
FROM venue v
CROSS JOIN LATERAL (
  SELECT DISTINCT sport_slug FROM (
    SELECT v.primary_sport_slug AS sport_slug
    UNION
    SELECT vs.sport_slug FROM venue_sport vs WHERE vs.venue_id = v.id
  ) u
  WHERE sport_slug IS NOT NULL
) s
WHERE v.is_published = TRUE AND v.deleted_at IS NULL;

-- UNIQUE (venue_id, sport_slug) → autorise REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_vss_pk
  ON mv_venue_sport_search (venue_id, sport_slug);

-- INDEX CLÉ : (sport_slug, geom) GIST → `sport_slug=X AND geom && bbox` index-seekable.
CREATE INDEX IF NOT EXISTS idx_mv_vss_sport_geom
  ON mv_venue_sport_search USING gist (sport_slug, geom);

-- ── MV 2 : agrégats grille × sport (bas zoom, sport filtré) ──────────────────
-- Mirroir de mv_venue_grid_agg (0039) mais clé = sport (depuis la MV éclatée).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_sport_grid_agg AS
SELECT
  g.grid_size_m,
  FLOOR(ST_X(ST_Transform(m.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_x,
  FLOOR(ST_Y(ST_Transform(m.geom::geometry, 3857)) / g.grid_size_m)::bigint AS cell_y,
  m.sport_slug,
  COUNT(*)::bigint               AS n,
  SUM(m.lat)::double precision    AS sum_lat,
  SUM(m.lon)::double precision    AS sum_lon
FROM mv_venue_sport_search m
CROSS JOIN (VALUES (500000.0), (200000.0), (100000.0), (50000.0)) AS g(grid_size_m)
GROUP BY g.grid_size_m, cell_x, cell_y, m.sport_slug;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_vsga_pk
  ON mv_venue_sport_grid_agg (grid_size_m, cell_x, cell_y, sport_slug);

GRANT SELECT ON mv_venue_sport_search   TO anon, authenticated;
GRANT SELECT ON mv_venue_sport_grid_agg TO anon, authenticated;
