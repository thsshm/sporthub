-- Étend venues_in_bbox (0006) pour accepter un filtre `feat TEXT[]` optionnel.
-- Reprend les filtres "Critères" universels du V1 (sporthub-map.js V1) :
--   - "lit"        → v.has_lighting = TRUE
--   - "indoor"     → v.is_indoor = TRUE         (alias "covered")
--   - "wheelchair" → v.is_wheelchair_accessible = TRUE
--   - "free"       → v.fee_required = FALSE
--   - "paid"       → v.fee_required = TRUE
--
-- Sémantique : AND entre les critères sélectionnés. Si feat est NULL ou {},
-- aucun filtre critère n'est appliqué.
--
-- DROP nécessaire car CREATE OR REPLACE ne supporte pas un changement de
-- signature.

DROP FUNCTION IF EXISTS venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, INTEGER
);

CREATE OR REPLACE FUNCTION venues_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL,
  feat  TEXT[] DEFAULT NULL,
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
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
    -- Filtres "Critères" : AND entre chaque critère sélectionné
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS TRUE)
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

GRANT EXECUTE ON FUNCTION venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], INTEGER
) TO anon, authenticated;
