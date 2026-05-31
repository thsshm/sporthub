-- RPC venues_clustered(bbox, zoom) — agrégation serveur selon le niveau de zoom.
--
-- Objectif : éviter d'envoyer 348k POI au client. Selon le zoom, retourne :
--   - zoom < 6  : 1 bulle par pays (country_code) avec centroid + count
--   - 6 ≤ zoom < 10 : 1 bulle par cellule ST_SnapToGrid (grille en degrés)
--   - zoom ≥ 10 : POI individuels (délègue à venues_in_bbox)
--
-- ST_SnapToGrid n'exige que PostGIS (déjà présent, cf. migration 0003).
-- H3 aurait été plus propre mais requiert l'extension h3-pg non activée par
-- défaut sur Supabase — ST_SnapToGrid est suffisant pour un MVP.
--
-- Taille de cellule selon le zoom (mapping empirique) :
--   zoom 6-7  → 5° (~500 km) → vue continent, quelques centaines de bulles
--   zoom 8-9  → 1° (~100 km) → vue région, quelques centaines de bulles
--
-- Cf. issue #114.

-- Type de retour commun pour les 3 tiers.
-- `cluster_id` : identifiant opaque (country_code ou coordonnées grille).
-- `count` : 0 pour les POI individuels (cluster = false).
-- `lat`, `lon` : centroid du cluster ou position du POI.
-- `is_cluster` : true pour les agrégats, false pour les pins individuels.
-- Champs POI optionnels (NULL pour les agrégats) : id, slug, name,
--   family_slug, primary_sport_slug.

-- Tier 1 — agrégats par pays (zoom < 6)
CREATE OR REPLACE FUNCTION venues_clustered_country(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL
)
RETURNS TABLE (
  cluster_id         TEXT,
  count              BIGINT,
  lat                DOUBLE PRECISION,
  lon                DOUBLE PRECISION,
  is_cluster         BOOLEAN,
  id                 UUID,
  slug               TEXT,
  name               TEXT,
  family_slug        TEXT,
  primary_sport_slug TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    v.country_code::TEXT                      AS cluster_id,
    COUNT(*)                                  AS count,
    ST_Y(ST_Centroid(ST_Collect(v.geom::geometry)))::DOUBLE PRECISION AS lat,
    ST_X(ST_Centroid(ST_Collect(v.geom::geometry)))::DOUBLE PRECISION AS lon,
    TRUE                                      AS is_cluster,
    NULL::UUID                                AS id,
    NULL::TEXT                                AS slug,
    NULL::TEXT                                AS name,
    NULL::TEXT                                AS family_slug,
    NULL::TEXT                                AS primary_sport_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
    AND v.country_code IS NOT NULL
  GROUP BY v.country_code
  ORDER BY count DESC
  LIMIT 300;
$$;

-- Tier 2 — agrégats par grille ST_SnapToGrid (6 ≤ zoom < 10)
CREATE OR REPLACE FUNCTION venues_clustered_grid(
  west      DOUBLE PRECISION,
  south     DOUBLE PRECISION,
  east      DOUBLE PRECISION,
  north     DOUBLE PRECISION,
  cell_deg  DOUBLE PRECISION DEFAULT 1.0,
  fams      TEXT[] DEFAULT NULL,
  sport     TEXT   DEFAULT NULL
)
RETURNS TABLE (
  cluster_id         TEXT,
  count              BIGINT,
  lat                DOUBLE PRECISION,
  lon                DOUBLE PRECISION,
  is_cluster         BOOLEAN,
  id                 UUID,
  slug               TEXT,
  name               TEXT,
  family_slug        TEXT,
  primary_sport_slug TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    (ST_X(ST_SnapToGrid(v.geom::geometry, cell_deg))::TEXT
      || ',' ||
     ST_Y(ST_SnapToGrid(v.geom::geometry, cell_deg))::TEXT) AS cluster_id,
    COUNT(*)                                                  AS count,
    AVG(v.lat)::DOUBLE PRECISION                              AS lat,
    AVG(v.lon)::DOUBLE PRECISION                              AS lon,
    TRUE                                                      AS is_cluster,
    NULL::UUID                                                AS id,
    NULL::TEXT                                                AS slug,
    NULL::TEXT                                                AS name,
    NULL::TEXT                                                AS family_slug,
    NULL::TEXT                                                AS primary_sport_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
  GROUP BY ST_SnapToGrid(v.geom::geometry, cell_deg)
  ORDER BY count DESC
  LIMIT 500;
$$;

-- Grants pour les 3 fonctions (anon + authenticated, lecture publique)
GRANT EXECUTE ON FUNCTION venues_clustered_country(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION venues_clustered_grid(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, TEXT[], TEXT
) TO anon, authenticated;
