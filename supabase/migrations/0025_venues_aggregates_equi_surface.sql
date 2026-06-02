-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0025 : clustering équi-surface (web-mercator) (#229)
-- ════════════════════════════════════════════════════════════════════════
-- Phase 1.C de la Roadmap scalabilité (docs/ROADMAP-SCALE.md).
--
-- PROBLÈME : la branche grille de venues_aggregates groupait par
--   FLOOR(v.lat / grid_size_deg), FLOOR(v.lon / grid_size_deg)
-- en DEGRÉS. Conséquence : convergence des méridiens vers les pôles →
-- cellules minuscules à haute latitude (60°N : ~moitié moins larges qu'à
-- l'équateur pour le même grid_size en degrés). Les bulles de cluster sont
-- incohérentes : un pays scandinave dense semble épars, un pays équatorial
-- clairsemé semble dense.
--
-- FIX : projeter en web-mercator (EPSG:3857) avant de snapper à la grille.
-- L'espace mercator est isotrope sur l'axe horizontal pour une latitude donnée
-- (il distord l'échelle verticale vers les pôles, mais les cellules restent
-- visuellement cohérentes car la carte est aussi affichée en mercator).
--
--   FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / grid_size_m)
--   FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / grid_size_m)
--
-- Grille en mètres (correspondance approximative avec les degrés précédents) :
--   zoom ≤6 → 500 000 m (≈5° à l'équateur, cellules continent/pays)
--   zoom  7 → 200 000 m (≈2°, cellules région)
--   zoom  8 → 100 000 m (≈1°, cellules département)
--   zoom ≥9 →  50 000 m (≈0.5°, cellules arrondissement)
--
-- v.geom est de type geography(POINT, 4326) → cast en geometry pour
-- ST_Transform. Résultat : coordonnées en mètres EPSG:3857.
--
-- La branche zoom<6 (GROUP BY country_code) est inchangée : le découpage
-- pays est déjà équi-surface par définition.
--
-- Incorpore aussi la branche retraites (0024) pour rester source de vérité.
--
-- Idempotent (CREATE OR REPLACE). Transactionnel.
-- ════════════════════════════════════════════════════════════════════════

-- ── Validation avant/après (ne pas exécuter en migration — pour debug) ──────
--
-- Comparer les counts sur 3 latitudes (équateur, 45°N, 60°N) entre
-- l'ancienne et la nouvelle version :
--
--  Équateur  (Lagos, Nigeria) :         bbox west=2 south=5 east=5 north=8
--  45°N      (Lyon, France)   :         bbox west=4 south=44 east=7 north=47
--  60°N      (Oslo, Norvège)  :         bbox west=9 south=59 east=12 north=62
--
-- SELECT COUNT(*), ROUND(AVG(lat)::numeric,2), ROUND(AVG(lon)::numeric,2)
-- FROM venues_aggregates(2.0,5.0,5.0,8.0, 7, NULL, NULL);   -- équateur
-- SELECT COUNT(*), ROUND(AVG(lat)::numeric,2), ROUND(AVG(lon)::numeric,2)
-- FROM venues_aggregates(4.0,44.0,7.0,47.0, 7, NULL, NULL); -- 45°N
-- SELECT COUNT(*), ROUND(AVG(lat)::numeric,2), ROUND(AVG(lon)::numeric,2)
-- FROM venues_aggregates(9.0,59.0,12.0,62.0, 7, NULL, NULL);-- 60°N
--
-- Résultat attendu : densité de clusters cohérente entre les 3 zones
-- pour un viewport de même taille (même nombre de cellules remplies).
-- ────────────────────────────────────────────────────────────────────────

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
  grid_size_m DOUBLE PRECISION;  -- grille en mètres (web-mercator)
BEGIN
  -- Branche zoom < 6 : agrégats par pays (country_code).
  -- Pas de grille spatiale → pas d'artefact latitude → inchangée.
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

  -- Branche zoom ≥ 6 : grille équi-surface en mètres (web-mercator EPSG:3857).
  -- Remplace la grille en degrés (artefact convergence méridiens, cf. #229).
  IF zoom_level <= 6 THEN
    grid_size_m := 500000.0;  -- 500 km  (≈ 5° à l'équateur)
  ELSIF zoom_level = 7 THEN
    grid_size_m := 200000.0;  -- 200 km  (≈ 2°)
  ELSIF zoom_level = 8 THEN
    grid_size_m := 100000.0;  -- 100 km  (≈ 1°)
  ELSE
    grid_size_m :=  50000.0;  --  50 km  (≈ 0.5°)
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
    -- Projection web-mercator (EPSG:3857) avant snap → cellules isotropes
    -- quelle que soit la latitude (plus d'artefact haute latitude, #229).
    -- v.geom est geography → cast geometry pour ST_Transform.
    FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / grid_size_m),
    FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / grid_size_m);
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT
) TO anon, authenticated;
