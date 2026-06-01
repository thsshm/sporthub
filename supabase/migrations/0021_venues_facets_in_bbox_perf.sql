-- Perf fix de venues_facets_in_bbox (0019) — timeout statement (#279).
--
-- Symptôme : la fonction 0019 timeout (Postgres 57014, >3s) même sur une bbox
-- ~1 km, alors que venues_in_bbox répond en ~1.2s sur la même zone.
--
-- Cause : depuis PostgreSQL 12, un CTE non marqué MATERIALIZED est INLINÉ dans
-- la requête principale. Le CTE `base` (scan spatial coûteux avec cast
-- ::geography sur l'index GIST) était donc ré-exécuté UNE FOIS PAR BRANCHE du
-- UNION ALL (familles / critères / surfaces) = 3 scans spatiaux au lieu d'un.
-- 3× le coût du scan → timeout.
--
-- Fix : forcer `MATERIALIZED` sur le CTE de base pour que le scan spatial +
-- le calcul match_surfaces ne s'exécutent QU'UNE fois, puis soient réutilisés
-- par les 3 branches d'agrégation (qui ne travaillent plus que sur le petit
-- jeu de lignes du viewport, en mémoire).
--
-- Sémantique identique à 0019 (faceted counts). Seul le plan d'exécution change.
-- CREATE OR REPLACE : même signature, pas de DROP nécessaire.

CREATE OR REPLACE FUNCTION venues_facets_in_bbox(
  west  DOUBLE PRECISION,
  south DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  fams  TEXT[] DEFAULT NULL,
  feat  TEXT[] DEFAULT NULL,
  surfaces TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  facet_type TEXT,
  facet_key  TEXT,
  n          BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- MATERIALIZED : force un seul scan spatial GIST partagé par les 3 branches
  -- du UNION ALL (sinon inliné + ré-exécuté 3×, cause du timeout 0019).
  base_surf AS MATERIALIZED (
    SELECT v.id, v.family_slug, v.has_lighting, v.is_indoor,
           v.is_wheelchair_accessible, v.fee_required,
           (surfaces IS NULL OR EXISTS (
             SELECT 1 FROM venue_sport vs
             WHERE vs.venue_id = v.id AND vs.surface = ANY(surfaces)
           )) AS match_surfaces
    FROM venue v
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
  )

  -- ── FAMILLES : applique feat + surfaces, ignore fams ──────────────────────
  SELECT 'family'::TEXT AS facet_type, bs.family_slug AS facet_key, COUNT(*)::BIGINT AS n
  FROM base_surf bs
  WHERE bs.match_surfaces
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
    AND bs.family_slug IS NOT NULL
  GROUP BY bs.family_slug

  UNION ALL

  -- ── CRITÈRES : applique fams + surfaces + les AUTRES critères actifs ───────
  SELECT 'criteria'::TEXT, k.key, COUNT(*)::BIGINT
  FROM base_surf bs
  CROSS JOIN LATERAL (
    VALUES
      ('lit',        bs.has_lighting IS TRUE),
      ('indoor',     bs.is_indoor IS TRUE),
      ('wheelchair', bs.is_wheelchair_accessible IS TRUE),
      ('free',       bs.fee_required IS FALSE),
      ('paid',       bs.fee_required IS TRUE)
  ) AS k(key, has_it)
  WHERE bs.match_surfaces
    AND (fams IS NULL OR bs.family_slug = ANY(fams))
    AND k.has_it
    AND ('lit'        = k.key OR 'lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     = k.key OR 'indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' = k.key OR 'wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       = k.key OR 'free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       = k.key OR 'paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
  GROUP BY k.key

  UNION ALL

  -- ── SURFACES : applique fams + feat, ignore surfaces ──────────────────────
  -- Jointure venue_sport sur le petit jeu déjà filtré spatialement (base_surf).
  SELECT 'surface'::TEXT, vs.surface, COUNT(DISTINCT bs.id)::BIGINT
  FROM base_surf bs
  JOIN venue_sport vs ON vs.venue_id = bs.id
  WHERE vs.surface IS NOT NULL
    AND (fams IS NULL OR bs.family_slug = ANY(fams))
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
  GROUP BY vs.surface;
$$;

GRANT EXECUTE ON FUNCTION venues_facets_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
