-- Étend venues_in_bbox (0004) pour accepter un filtre `sport` optionnel.
-- Utilisé par /api/venues?sport=padel et par /sports/[sport] qui veut afficher
-- tous les venues d'un sport dans le viewport courant (au lieu des 24 paginés).
--
-- Change la signature : ajout du param `sport TEXT DEFAULT NULL` avant max_results.
-- DROP nécessaire car CREATE OR REPLACE ne supporte pas un changement de signature.

DROP FUNCTION IF EXISTS venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], INTEGER
);

CREATE OR REPLACE FUNCTION venues_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL,
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
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

GRANT EXECUTE ON FUNCTION venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, INTEGER
) TO anon, authenticated;
