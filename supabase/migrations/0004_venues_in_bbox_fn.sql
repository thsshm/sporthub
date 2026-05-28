-- Fonction RPC pour récupérer les venues dans une bounding box, optionnellement
-- filtrés par famille. Utilisée par /api/venues pour le rendu de la carte
-- bbox-aware (cf. issue #36).
--
-- L'opérateur `&&` (bounding box overlap) utilise l'index GIST sur venue.geom
-- créé en migration 0003 → très rapide même sur 348k+ venues.

CREATE OR REPLACE FUNCTION venues_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
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
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

-- Exposé aux clients anon + authenticated (lecture publique)
GRANT EXECUTE ON FUNCTION venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], INTEGER
) TO anon, authenticated;
