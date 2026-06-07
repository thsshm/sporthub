-- ════════════════════════════════════════════════════════════════════════
-- Migration 0037 : FIX venues_in_bbox — restaure SECURITY DEFINER + retraites
-- ════════════════════════════════════════════════════════════════════════
-- INCIDENT : la migration 0036 a recréé venues_in_bbox à partir du corps 0016
-- (obsolète), ce qui a RÉVERTÉ par erreur :
--   - le SECURITY DEFINER + search_path ajoutés en 0018 (#225) → en anon, le
--     coût RLS par ligne réapparaissait → statement_timeout (57014) sur
--     /api/venues → carte de prod cassée au zoom ≥ 10.
--   - le filtre famille 'retraites' (retreat_type) ajouté en 0024.
--
-- Ce fix repart de la définition 0024 (la vraie dernière) et y ajoute la seule
-- nouveauté légitime de 0036 : la colonne `club_id` en sortie (#311).
-- DROP + CREATE car la table de retour change (ajout de club_id).
-- ════════════════════════════════════════════════════════════════════════

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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug, v.club_id
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
