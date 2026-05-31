-- Étend venues_in_bbox (0007) avec un filtre `surfaces TEXT[]` optionnel (#99).
--
-- La surface d'un terrain est portée par `venue_sport` (par couple venue×sport),
-- PAS par `venue`. On filtre donc via EXISTS : un venue match s'il a au moins un
-- sport joué sur l'une des surfaces demandées.
--
-- Valeurs canoniques (issue #99) : clay, concrete, synthetic, grass, parquet, sand.
-- Sémantique : surfaces NULL ou {} → aucun filtre surface. Combiné en AND avec
-- les autres filtres (fams / sport / feat). Additif et rétro-compatible : les
-- appelants qui ne passent pas `surfaces` (named args) gardent l'ancien comportement.
--
-- DROP nécessaire car CREATE OR REPLACE ne supporte pas un changement de
-- signature (on insère `surfaces` avant `max_results`).

DROP FUNCTION IF EXISTS venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], INTEGER
);

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
    -- Filtre surface : au moins un sport joué sur une des surfaces demandées
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
