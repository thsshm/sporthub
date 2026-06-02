-- venues_facets_in_bbox en SECURITY DEFINER — fix timeout réel (#279).
--
-- Le perf fix 0021 (CTE MATERIALIZED) NE SUFFISAIT PAS : la fonction
-- timeout toujours (>3s) même sur une bbox VIDE (0 lieu). Un timeout sur zone
-- vide exclut le scan spatial comme cause → c'est le coût RLS PAR LIGNE.
--
-- venues_facets_in_bbox était en SECURITY INVOKER : chaque ligne candidate
-- subit l'évaluation de la policy RLS de `venue`, ce qui provoque le
-- statement_timeout sur les régions peu denses — EXACTEMENT le problème que la
-- migration 0018 a résolu pour venues_in_bbox / venues_aggregates / venues_global
-- en les passant en SECURITY DEFINER (cf. #225).
--
-- Fix : aligner venues_facets_in_bbox sur ses sœurs → SECURITY DEFINER +
-- `SET search_path = public, pg_temp` (durcissement obligatoire pour toute
-- fonction DEFINER : empêche un appelant de détourner la résolution de noms).
--
-- Sécurité : la fonction filtre déjà `is_published = TRUE AND deleted_at IS NULL`
-- en interne → aucune ligne "privée" ne fuit, exactement comme venues_in_bbox.
-- Corps identique à 0021 (MATERIALIZED conservé). Seul le mode de sécurité change.

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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH
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
