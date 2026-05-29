-- Variante "minimal payload" de venues_in_bbox (0007) pour /api/venues.
--
-- Contexte (issue #113) : la carte n'utilise jamais `primary_sport_slug` côté
-- client — seuls 6 champs sont nécessaires pour rendre un pin et son popup
-- (id, slug, name, lat, lon, family_slug). En supprimant `primary_sport_slug`
-- de la projection RPC on réduit :
--   - le payload réseau Supabase → Next.js (~15 % de bytes en moins)
--   - le payload final Next.js → client (idem)
--   - le coût de sérialisation JSON côté Edge runtime
--
-- Le reste de la signature (filtres bbox, fams, sport, feat, max_results)
-- est identique à 0007. Cette RPC est volontairement créée à côté plutôt
-- qu'en remplacement : 0007 reste utile pour les Server Components qui ont
-- besoin de primary_sport_slug pour le rendu SSR.

CREATE OR REPLACE FUNCTION venues_in_bbox_minimal(
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
  id          UUID,
  slug        TEXT,
  name        TEXT,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  family_slug TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
    -- Filtres "Critères" : AND entre chaque critère sélectionné (cf. 0007)
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS TRUE)
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

GRANT EXECUTE ON FUNCTION venues_in_bbox_minimal(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT, TEXT[], INTEGER
) TO anon, authenticated;
