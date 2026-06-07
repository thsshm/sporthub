-- ════════════════════════════════════════════════════════════════════════
-- Migration 0040 : venues_aggregates lit les MV (fix timeout #387)
-- ════════════════════════════════════════════════════════════════════════
-- Réécrit venues_aggregates pour lire mv_venue_country_agg / mv_venue_grid_agg
-- (migration 0039) au lieu d'agréger venue en live → plus de statement_timeout.
--
-- Signature + sortie INCHANGÉES (zéro impact route/front). Conserve SECURITY
-- DEFINER + search_path + le filtre famille 'retraites' (cf. def 0025).
--
-- Sémantique :
--   - zoom < 6 : 1 bulle par pays (centroïde pondéré du pays), filtrée aux pays
--     dont le centroïde tombe dans la bbox.
--   - zoom 6-9 : grille équi-surface (mercator 3857), 4 tailles selon le zoom ;
--     les cellules sont pré-calculées dans la MV, on filtre par plage de
--     cell_x/cell_y dérivée de la bbox transformée en 3857.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION venues_aggregates(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  zoom_level INTEGER,
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL
)
RETURNS TABLE (
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  count        BIGINT,
  country_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  grid_size_m DOUBLE PRECISION;
  env3857     geometry;
  min_cx BIGINT; max_cx BIGINT; min_cy BIGINT; max_cy BIGINT;
BEGIN
  -- ── zoom < 6 : agrégats par pays (lecture mv_venue_country_agg) ──
  IF zoom_level < 6 THEN
    RETURN QUERY
    SELECT
      (SUM(a.sum_lat) / SUM(a.n))::DOUBLE PRECISION AS lat,
      (SUM(a.sum_lon) / SUM(a.n))::DOUBLE PRECISION AS lon,
      SUM(a.n)::BIGINT AS count,
      a.country_code
    FROM mv_venue_country_agg a
    WHERE (fams IS NULL
           OR a.family_slug = ANY(fams)
           OR ('retraites' = ANY(fams) AND a.is_retreat))
      AND (sport IS NULL OR a.primary_sport_slug = sport)
    GROUP BY a.country_code
    HAVING (SUM(a.sum_lon) / SUM(a.n)) BETWEEN west AND east
       AND (SUM(a.sum_lat) / SUM(a.n)) BETWEEN south AND north;
    RETURN;
  END IF;

  -- ── zoom 6-9 : grille (lecture mv_venue_grid_agg) ──
  IF zoom_level <= 6 THEN
    grid_size_m := 500000.0;
  ELSIF zoom_level = 7 THEN
    grid_size_m := 200000.0;
  ELSIF zoom_level = 8 THEN
    grid_size_m := 100000.0;
  ELSE
    grid_size_m := 50000.0;
  END IF;

  -- bbox 4326 → 3857 pour dériver la plage de cellules à lire.
  env3857 := ST_Transform(ST_MakeEnvelope(west, south, east, north, 4326), 3857);
  min_cx := FLOOR(ST_XMin(env3857) / grid_size_m);
  max_cx := FLOOR(ST_XMax(env3857) / grid_size_m);
  min_cy := FLOOR(ST_YMin(env3857) / grid_size_m);
  max_cy := FLOOR(ST_YMax(env3857) / grid_size_m);

  RETURN QUERY
  SELECT
    (SUM(a.sum_lat) / SUM(a.n))::DOUBLE PRECISION AS lat,
    (SUM(a.sum_lon) / SUM(a.n))::DOUBLE PRECISION AS lon,
    SUM(a.n)::BIGINT AS count,
    NULL::TEXT AS country_code
  FROM mv_venue_grid_agg a
  WHERE a.grid_size_m = grid_size_m
    AND a.cell_x BETWEEN min_cx AND max_cx
    AND a.cell_y BETWEEN min_cy AND max_cy
    AND (fams IS NULL
         OR a.family_slug = ANY(fams)
         OR ('retraites' = ANY(fams) AND a.is_retreat))
    AND (sport IS NULL OR a.primary_sport_slug = sport)
  GROUP BY a.cell_x, a.cell_y;
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT
) TO anon, authenticated;
