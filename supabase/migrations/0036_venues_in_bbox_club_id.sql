-- Étend venues_in_bbox (0016) en ajoutant `club_id` à la sortie (#311 / #130).
--
-- Objectif : permettre à la carte de distinguer, au zoom 10-15 en vue club,
-- les venues déjà regroupées dans un club (à masquer — représentées par un
-- pin club) des venues isolées (club_id NULL, à afficher en pin individuel).
--
-- 100 % ADDITIF et rétro-compatible : mêmes paramètres, même logique, même
-- filtres. On ajoute UNIQUEMENT la colonne `club_id` au RETURNS et `v.club_id`
-- au SELECT. Les appelants existants (cast `as VenuePin[]`) ignorent la colonne
-- supplémentaire → aucun changement de comportement.
--
-- DROP nécessaire car CREATE OR REPLACE ne supporte pas un changement de la
-- table de retour (ajout d'une colonne de sortie).

DROP FUNCTION IF EXISTS venues_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], TEXT[], INTEGER
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
  primary_sport_slug  TEXT,
  club_id             UUID
)
LANGUAGE SQL
STABLE
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug, v.club_id
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
