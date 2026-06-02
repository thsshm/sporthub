-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0023 : câble le filtre famille 'retraites' (#295)
-- ════════════════════════════════════════════════════════════════════════
-- Palier 2 de l'issue #288. Le palier 1 (0022) a posé la colonne
-- venue.retreat_type (tag transverse, 393 venues). Rien ne la lisait encore.
--
-- Problème : filtrer families=retraites via family_slug='retraites' ne matche
-- AUCUNE venue (les 393 retraites conservent leur family_slug d'origine :
-- fitness, yoga, raquette…). La famille 'retraites' est un overlay éditorial.
--
-- Fix : dans chaque RPC qui accepte `fams TEXT[]`, remplacer le prédicat
-- naïf `family_slug = ANY(fams)` par le prédicat composite :
--
--   (fams IS NULL
--     OR v.family_slug = ANY(fams)
--     OR ('retraites' = ANY(fams) AND v.retreat_type IS NOT NULL))
--
-- Sémantique : un lieu est "dans les fams demandées" s'il appartient à une
-- famille explicitement demandée OU si 'retraites' est demandée ET qu'il est
-- tagué retraite. Pas de doublon pour les venues multi-tags : un yoga-retraite
-- est compté une fois quand on filtre retraites, une fois quand on filtre yoga.
--
-- RPCs touchées :
--   1. venues_in_bbox          (pois — 0018)
--   2. venues_aggregates       (clusters — 0018, 2 branches)
--   3. venues_facets_in_bbox   (facets — 0021) :
--        - CTE base_surf : +retreat_type pour les prédicats ci-dessous
--        - famille synthétique 'retraites' (UNION ALL)
--        - prédicats fams dans critères + surfaces
--
-- NB : venues_global (lecture morte) et clubs_in_bbox → non touchées.
-- La route /api/venues mode global fait un select direct → patchée côté TS
-- (app/api/venues/route.ts, même commit).
--
-- Idempotent (CREATE OR REPLACE). Transactionnel (pas d'index CONCURRENTLY).
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. venues_in_bbox ───────────────────────────────────────────────────────
-- Prédicat fams : +branche retraites. Reste identique à 0018.

CREATE OR REPLACE FUNCTION venues_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL,
  feat  TEXT[] DEFAULT NULL,
  surfaces TEXT[] DEFAULT NULL,
  max_results INTEGER DEFAULT 2000
)
RETURNS TABLE (
  id                  UUID,
  slug                TEXT,
  name                TEXT,
  lat                 DOUBLE PRECISION,
  lon                 DOUBLE PRECISION,
  family_slug         TEXT,
  primary_sport_slug  TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL
         OR v.family_slug = ANY(fams)
         OR ('retraites' = ANY(fams) AND v.retreat_type IS NOT NULL))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS TRUE)
    AND (surfaces IS NULL OR EXISTS (
      SELECT 1
      FROM venue_sport vs
      WHERE vs.venue_id = v.id
        AND vs.surface = ANY(surfaces)
    ))
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

GRANT EXECUTE ON FUNCTION venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], TEXT[], INTEGER
) TO anon, authenticated;

-- ─── 2. venues_aggregates ────────────────────────────────────────────────────
-- 2 branches (zoom < 6 groupe par country_code, zoom ≥ 6 groupe par cellule).
-- Même prédicat composite sur fams dans les deux.

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
  grid_size DOUBLE PRECISION;
BEGIN
  IF zoom_level < 6 THEN
    RETURN QUERY
    SELECT
      AVG(v.lat)::DOUBLE PRECISION AS lat,
      AVG(v.lon)::DOUBLE PRECISION AS lon,
      COUNT(*)::BIGINT AS count,
      v.country_code
    FROM venue v
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
      AND v.country_code IS NOT NULL
      AND (fams IS NULL
           OR v.family_slug = ANY(fams)
           OR ('retraites' = ANY(fams) AND v.retreat_type IS NOT NULL))
      AND (sport IS NULL OR v.primary_sport_slug = sport)
    GROUP BY v.country_code;
    RETURN;
  END IF;

  IF zoom_level <= 6 THEN
    grid_size := 5.0;
  ELSIF zoom_level = 7 THEN
    grid_size := 2.0;
  ELSIF zoom_level = 8 THEN
    grid_size := 1.0;
  ELSE
    grid_size := 0.5;
  END IF;

  RETURN QUERY
  SELECT
    AVG(v.lat)::DOUBLE PRECISION AS lat,
    AVG(v.lon)::DOUBLE PRECISION AS lon,
    COUNT(*)::BIGINT AS count,
    NULL::TEXT AS country_code
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL
         OR v.family_slug = ANY(fams)
         OR ('retraites' = ANY(fams) AND v.retreat_type IS NOT NULL))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
  GROUP BY
    FLOOR(v.lat / grid_size),
    FLOOR(v.lon / grid_size);
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT
) TO anon, authenticated;

-- ─── 3. venues_facets_in_bbox ─────────────────────────────────────────────────
-- Reprend la version 0021 (MATERIALIZED, fix timeout) avec :
--   a) +retreat_type dans le CTE base_surf
--   b) Facette synthétique 'retraites' (UNION ALL après GROUP BY family_slug)
--   c) Prédicat composite fams dans critères + surfaces

CREATE OR REPLACE FUNCTION venues_facets_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  feat  TEXT[] DEFAULT NULL,
  surfaces TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  facet_type TEXT,
  facet_key  TEXT,
  n          BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- MATERIALIZED : scan spatial partagé (fix timeout 0021).
  -- +retreat_type pour la facette synthétique 'retraites' + prédicats fams.
  base_surf AS MATERIALIZED (
    SELECT v.id, v.family_slug, v.retreat_type,
           v.has_lighting, v.is_indoor,
           v.is_wheelchair_accessible, v.fee_required,
           (surfaces IS NULL OR EXISTS (
             SELECT 1 FROM venue_sport vs
             WHERE vs.venue_id = v.id AND vs.surface = ANY(surfaces)
           )) AS match_surfaces
    FROM venue v
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
  )

  -- ── FAMILLES par family_slug (hors retraites) ─────────────────────────────
  SELECT 'family'::TEXT AS facet_type, bs.family_slug AS facet_key, COUNT(*)::BIGINT AS n
  FROM base_surf bs
  WHERE bs.match_surfaces
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
    AND bs.family_slug IS NOT NULL
  GROUP BY bs.family_slug

  UNION ALL

  -- ── FAMILLE synthétique 'retraites' ───────────────────────────────────────
  -- Les venues retraites gardent leur family_slug d'origine (fitness, yoga…) ;
  -- ce bloc les compte sous la clé 'retraites' pour le panneau de filtres.
  -- On applique feat + surfaces (même sémantique que les familles "normales" :
  -- on ignore fams pour ne pas créer de cul-de-sac quand 'retraites' est déjà
  -- coché).
  SELECT 'family'::TEXT, 'retraites'::TEXT, COUNT(*)::BIGINT
  FROM base_surf bs
  WHERE bs.match_surfaces
    AND bs.retreat_type IS NOT NULL
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)

  UNION ALL

  -- ── CRITÈRES : applique fams (composite) + surfaces + autres critères ─────
  SELECT 'criteria'::TEXT, k.key, COUNT(*)::BIGINT
  FROM base_surf bs
  CROSS JOIN LATERAL (
    VALUES
      ('lit',        bs.has_lighting IS TRUE),
      ('indoor',     bs.is_indoor IS TRUE),
      ('wheelchair', bs.is_wheelchair_accessible IS TRUE),
      ('free',       bs.fee_required IS FALSE),
      ('paid',       bs.fee_required IS TRUE)
  ) AS k(key, has_it)
  WHERE bs.match_surfaces
    AND (fams IS NULL
         OR bs.family_slug = ANY(fams)
         OR ('retraites' = ANY(fams) AND bs.retreat_type IS NOT NULL))
    AND k.has_it
    AND ('lit'        = k.key OR 'lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     = k.key OR 'indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' = k.key OR 'wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       = k.key OR 'free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       = k.key OR 'paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
  GROUP BY k.key

  UNION ALL

  -- ── SURFACES : applique fams (composite) + feat ───────────────────────────
  SELECT 'surface'::TEXT, vs.surface, COUNT(DISTINCT bs.id)::BIGINT
  FROM base_surf bs
  JOIN venue_sport vs ON vs.venue_id = bs.id
  WHERE vs.surface IS NOT NULL
    AND (fams IS NULL
         OR bs.family_slug = ANY(fams)
         OR ('retraites' = ANY(fams) AND bs.retreat_type IS NOT NULL))
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
  GROUP BY vs.surface;
$$;

GRANT EXECUTE ON FUNCTION venues_facets_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
