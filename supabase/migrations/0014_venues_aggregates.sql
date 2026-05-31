-- Agrégats serveur pour la vue carte dézoomée (cf. issue #114).
--
-- À zoom < 10 on n'envoie plus 5000 POI individuels au client (348k venues au
-- total, le filtre bbox + index GIST suffit sur petite zone mais sur la France
-- entière à zoom 5 c'est insuffisant : timeout / 500 pins random). On agrège
-- côté serveur en bulles de densité :
--
--   - zoom < 6   → 1 bulle par country_code (≤ ~50 lignes)
--   - zoom 6-9   → quadrillage ST_SnapToGrid à pas variable (5° / 2° / 0.5°)
--
-- Le client (MapClient.tsx) affiche ces bulles en `circle-radius` proportionnel
-- au count, avec un label. À zoom ≥ 10 on bascule sur venues_in_bbox (POI).
--
-- ST_SnapToGrid (PostGIS natif) plutôt que h3-pg (extension à activer côté
-- Supabase, dette opérationnelle). Le quadrillage degré-aligné est moins joli
-- que des hex H3 mais suffit largement pour des bulles de densité.
--
-- Filtres : on supporte fams + sport (les mêmes que venues_in_bbox), pas feat
-- (peu utile à zoom dézoomé, et le filtrage en agrégat fait perdre le bénéfice
-- du cache long).

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
AS $$
DECLARE
  grid_size DOUBLE PRECISION;
BEGIN
  IF zoom_level < 6 THEN
    -- Tier "monde / continent" : 1 bulle par pays.
    -- Centroid via AVG(lat/lon) — moins précis que ST_Centroid(ST_Collect(geom))
    -- mais 100× plus rapide (pas de matérialisation de geom). Le centroid est
    -- utilisé seulement pour positionner la bulle, l'imprécision est invisible
    -- à ce zoom.
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
      AND (fams IS NULL OR v.family_slug = ANY(fams))
      AND (sport IS NULL OR v.primary_sport_slug = sport)
    GROUP BY v.country_code;
    RETURN;
  END IF;

  -- Tier "région" : quadrillage degré-aligné.
  --   zoom 6  → grille 5°   (~550 km à l'équateur)
  --   zoom 7  → grille 2°   (~220 km)
  --   zoom 8  → grille 1°   (~110 km)
  --   zoom 9  → grille 0.5° (~55 km)
  IF zoom_level <= 6 THEN
    grid_size := 5.0;
  ELSIF zoom_level = 7 THEN
    grid_size := 2.0;
  ELSIF zoom_level = 8 THEN
    grid_size := 1.0;
  ELSE
    -- zoom 9
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
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
  GROUP BY
    -- Snap au quadrillage degré-aligné. On floor(lat/grid)*grid pour obtenir
    -- la cellule, ce qui est l'équivalent géographique de ST_SnapToGrid(geom).
    -- On évite ST_SnapToGrid sur la geom geography (overhead non négligeable)
    -- au profit d'un floor scalaire sur lat/lon.
    FLOOR(v.lat / grid_size),
    FLOOR(v.lon / grid_size);
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT
) TO anon, authenticated;
