-- ════════════════════════════════════════════════════════════════════════
-- Migration 0055 : filtre sport multi-disciplines via mv_venue_sport_search (#476)
-- ════════════════════════════════════════════════════════════════════════
-- Branche le CAS SPORT FILTRÉ des 3 RPC sur les MV dénormalisées de 0054
-- (venue éclatée par {primary} ∪ venue_sport) → une venue multi-sport apparaît
-- sur TOUTES ses pages sport, de façon cohérente carte (POI + agrégats) + liste.
-- Cas famille/global (sport NULL) INCHANGÉ (lit mv_venue_grid_agg, 1 venue=1 ligne).
-- Signatures/sorties des RPC existants INCHANGÉES (zéro impact route).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. venues_in_bbox : POI — branche sport → mv_venue_sport_search ──────────
CREATE OR REPLACE FUNCTION venues_in_bbox(
  west DOUBLE PRECISION, south DOUBLE PRECISION, east DOUBLE PRECISION, north DOUBLE PRECISION,
  fams TEXT[] DEFAULT NULL, sport TEXT DEFAULT NULL, feat TEXT[] DEFAULT NULL,
  surfaces TEXT[] DEFAULT NULL, max_results INTEGER DEFAULT 2000
)
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  family_slug TEXT, primary_sport_slug TEXT, club_id UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF sport IS NOT NULL THEN
    -- Lit la MV indexée gist(sport_slug, geom) → ~3 ms au zoom POI.
    RETURN QUERY
      SELECT m.venue_id, m.slug, m.name, m.lat, m.lon, m.family_slug, m.primary_sport_slug, m.club_id
      FROM mv_venue_sport_search m
      WHERE m.sport_slug = sport
        AND m.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
        AND (fams IS NULL OR m.family_slug = ANY(fams))
        AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR m.has_lighting IS TRUE)
        AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR m.is_indoor IS TRUE)
        AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR m.is_wheelchair_accessible IS TRUE)
        AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR m.fee_required IS FALSE)
        AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR m.fee_required IS TRUE)
        AND (surfaces IS NULL OR EXISTS (
          SELECT 1 FROM venue_sport vs WHERE vs.venue_id = m.venue_id AND vs.surface = ANY(surfaces)))
      LIMIT GREATEST(1, LEAST(max_results, 5000));
    RETURN;
  END IF;

  -- Cas famille/global (inchangé, def 0037).
  RETURN QUERY
    SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug, v.club_id
    FROM venue v
    WHERE v.is_published = TRUE AND v.deleted_at IS NULL
      AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
      AND (fams IS NULL OR v.family_slug = ANY(fams)
           OR ('retraites' = ANY(fams) AND v.retreat_type IS NOT NULL))
      AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.has_lighting IS TRUE)
      AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_indoor IS TRUE)
      AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_wheelchair_accessible IS TRUE)
      AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS FALSE)
      AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS TRUE)
      AND (surfaces IS NULL OR EXISTS (
        SELECT 1 FROM venue_sport vs WHERE vs.venue_id = v.id AND vs.surface = ANY(surfaces)))
    LIMIT GREATEST(1, LEAST(max_results, 5000));
END;
$$;

GRANT EXECUTE ON FUNCTION venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], TEXT[], INTEGER) TO anon, authenticated;

-- ── 2. venues_aggregates : bas zoom — branche sport → mv_venue_sport_grid_agg ─
CREATE OR REPLACE FUNCTION venues_aggregates(
  west DOUBLE PRECISION, south DOUBLE PRECISION, east DOUBLE PRECISION, north DOUBLE PRECISION,
  zoom_level INTEGER, fams TEXT[] DEFAULT NULL, sport TEXT DEFAULT NULL
)
RETURNS TABLE (lat DOUBLE PRECISION, lon DOUBLE PRECISION, count BIGINT, country_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_grid DOUBLE PRECISION; env3857 geometry;
  min_cx BIGINT; max_cx BIGINT; min_cy BIGINT; max_cy BIGINT;
BEGIN
  v_grid := CASE WHEN zoom_level <= 6 THEN 500000.0 WHEN zoom_level = 7 THEN 200000.0
                 WHEN zoom_level = 8 THEN 100000.0 ELSE 50000.0 END;

  -- SPORT FILTRÉ : grille × sport (depuis la MV éclatée), à tous les zooms < 10.
  IF sport IS NOT NULL THEN
    env3857 := ST_Transform(ST_MakeEnvelope(west, south, east, north, 4326), 3857);
    min_cx := FLOOR(ST_XMin(env3857) / v_grid); max_cx := FLOOR(ST_XMax(env3857) / v_grid);
    min_cy := FLOOR(ST_YMin(env3857) / v_grid); max_cy := FLOOR(ST_YMax(env3857) / v_grid);
    RETURN QUERY
      SELECT (SUM(a.sum_lat) / SUM(a.n))::DOUBLE PRECISION,
             (SUM(a.sum_lon) / SUM(a.n))::DOUBLE PRECISION,
             SUM(a.n)::BIGINT, NULL::TEXT
      FROM mv_venue_sport_grid_agg a
      WHERE a.grid_size_m = v_grid
        AND a.cell_x BETWEEN min_cx AND max_cx AND a.cell_y BETWEEN min_cy AND max_cy
        AND a.sport_slug = sport
      GROUP BY a.cell_x, a.cell_y;
    RETURN;
  END IF;

  -- Cas famille/global (inchangé, def 0040).
  IF zoom_level < 6 THEN
    RETURN QUERY
      SELECT (SUM(a.sum_lat) / SUM(a.n))::DOUBLE PRECISION, (SUM(a.sum_lon) / SUM(a.n))::DOUBLE PRECISION,
             SUM(a.n)::BIGINT, a.country_code
      FROM mv_venue_country_agg a
      WHERE (fams IS NULL OR a.family_slug = ANY(fams) OR ('retraites' = ANY(fams) AND a.is_retreat))
      GROUP BY a.country_code
      HAVING (SUM(a.sum_lon) / SUM(a.n)) BETWEEN west AND east
         AND (SUM(a.sum_lat) / SUM(a.n)) BETWEEN south AND north;
    RETURN;
  END IF;

  env3857 := ST_Transform(ST_MakeEnvelope(west, south, east, north, 4326), 3857);
  min_cx := FLOOR(ST_XMin(env3857) / v_grid); max_cx := FLOOR(ST_XMax(env3857) / v_grid);
  min_cy := FLOOR(ST_YMin(env3857) / v_grid); max_cy := FLOOR(ST_YMax(env3857) / v_grid);
  RETURN QUERY
    SELECT (SUM(a.sum_lat) / SUM(a.n))::DOUBLE PRECISION, (SUM(a.sum_lon) / SUM(a.n))::DOUBLE PRECISION,
           SUM(a.n)::BIGINT, NULL::TEXT
    FROM mv_venue_grid_agg a
    WHERE a.grid_size_m = v_grid
      AND a.cell_x BETWEEN min_cx AND max_cx AND a.cell_y BETWEEN min_cy AND max_cy
      AND (fams IS NULL OR a.family_slug = ANY(fams) OR ('retraites' = ANY(fams) AND a.is_retreat))
    GROUP BY a.cell_x, a.cell_y;
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT) TO anon, authenticated;

-- ── 3. venues_by_sport_list : liste SSR /sports/[sport] (multi-discipline) ────
-- Remplace le `.eq("primary_sport_slug")` de page.tsx. total_count via window.
CREATE OR REPLACE FUNCTION venues_by_sport_list(
  p_sport TEXT, p_min_quality INTEGER DEFAULT 0,
  p_indoor BOOLEAN DEFAULT FALSE, p_lit BOOLEAN DEFAULT FALSE, p_wheelchair BOOLEAN DEFAULT FALSE,
  p_free BOOLEAN DEFAULT FALSE, p_paid BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 24, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  family_slug TEXT, primary_sport_slug TEXT, address TEXT, courts_count INTEGER,
  country_code TEXT, city_name TEXT, city_country TEXT, total_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.venue_id, m.slug, m.name, m.lat, m.lon, m.family_slug, m.primary_sport_slug,
         m.address, m.courts_count, m.country_code, c.name, c.country_code,
         COUNT(*) OVER ()::BIGINT
  FROM mv_venue_sport_search m
  JOIN venue v ON v.id = m.venue_id
  LEFT JOIN city c ON c.id = m.city_id
  WHERE m.sport_slug = p_sport
    AND COALESCE(v.quality_score, 0) >= p_min_quality
    AND (NOT p_indoor     OR m.is_indoor IS TRUE)
    AND (NOT p_lit        OR m.has_lighting IS TRUE)
    AND (NOT p_wheelchair OR m.is_wheelchair_accessible IS TRUE)
    AND (NOT p_free       OR m.fee_required IS FALSE)
    AND (NOT p_paid       OR m.fee_required IS TRUE)
  ORDER BY m.venue_id
  LIMIT GREATEST(1, LEAST(p_limit, 100)) OFFSET GREATEST(0, p_offset);
$$;

GRANT EXECUTE ON FUNCTION venues_by_sport_list(
  TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, INTEGER) TO anon, authenticated;

-- ── 4. refresh : ajoute les 2 nouvelles MV (non-concurrent, comme 0041) ──────
CREATE OR REPLACE FUNCTION refresh_venue_aggregates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '300s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_country_agg;
  REFRESH MATERIALIZED VIEW mv_venue_grid_agg;
  REFRESH MATERIALIZED VIEW mv_venue_sport_search;
  REFRESH MATERIALIZED VIEW mv_venue_sport_grid_agg;
  ANALYZE mv_venue_sport_search;
  ANALYZE mv_venue_sport_grid_agg;
END;
$$;
