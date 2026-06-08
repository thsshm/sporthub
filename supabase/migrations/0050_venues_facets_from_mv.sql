-- ════════════════════════════════════════════════════════════════════════
-- Migration 0050 : venues_facets_in_bbox — fast-path MV sans filtre (#410)
-- ════════════════════════════════════════════════════════════════════════
-- Réécrit venues_facets_in_bbox en plpgsql :
--   - SI aucun filtre (fams/feat/surfaces tous NULL) → lit les MV de 0049
--     (mv_venue_facet_grid + mv_venue_facet_surface_grid) → plus de scan live
--     → règle le timeout cold-start #410 sur les vues denses (Paris/IDF).
--   - SINON → chemin LIVE INCHANGÉ (corps de 0026), car la sémantique
--     faceted-search filtrée dépend de la combinaison de filtres (non
--     précalculable). Les cas filtrés sont rares et le cache est chaud à ce
--     moment-là.
--
-- Signature + sortie INCHANGÉES (zéro impact route/front). SECURITY DEFINER +
-- search_path conservés.
--
-- ⚠️ APPROXIMATION (fast-path) : les compteurs viennent des cellules (grille
-- 1 km, 0049) qui CHEVAUCHENT la bbox → les cellules de bord incluent quelques
-- venues hors-vue → compteurs légèrement gonflés (acceptable pour des BADGES).
-- Le chemin live (filtres actifs) reste EXACT. À valider en prod (cf. PR).
-- ════════════════════════════════════════════════════════════════════════

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  env3857 geometry;
  min_cx BIGINT; max_cx BIGINT; min_cy BIGINT; max_cy BIGINT;
BEGIN
  -- ── FAST PATH : aucun filtre actif → lecture MV (fix cold-start #410) ──────
  IF fams IS NULL AND feat IS NULL AND surfaces IS NULL THEN
    env3857 := ST_Transform(ST_MakeEnvelope(west, south, east, north, 4326), 3857);
    min_cx := FLOOR(ST_XMin(env3857) / 1000.0);
    max_cx := FLOOR(ST_XMax(env3857) / 1000.0);
    min_cy := FLOOR(ST_YMin(env3857) / 1000.0);
    max_cy := FLOOR(ST_YMax(env3857) / 1000.0);

    RETURN QUERY
    -- FAMILLES : SUM(n) par famille sur les cellules de la bbox.
    SELECT 'family'::TEXT, g.family_slug, SUM(g.n)::BIGINT
    FROM mv_venue_facet_grid g
    WHERE g.cell_x BETWEEN min_cx AND max_cx
      AND g.cell_y BETWEEN min_cy AND max_cy
    GROUP BY g.family_slug

    UNION ALL

    -- CRITÈRES : somme des compteurs par critère, dépivoté en lignes facet.
    SELECT 'criteria'::TEXT, c.key, c.cnt
    FROM (
      SELECT
        SUM(g.n_lit)::BIGINT        AS lit,
        SUM(g.n_indoor)::BIGINT     AS indoor,
        SUM(g.n_wheelchair)::BIGINT AS wheelchair,
        SUM(g.n_free)::BIGINT       AS free,
        SUM(g.n_paid)::BIGINT       AS paid
      FROM mv_venue_facet_grid g
      WHERE g.cell_x BETWEEN min_cx AND max_cx
        AND g.cell_y BETWEEN min_cy AND max_cy
    ) s
    CROSS JOIN LATERAL (VALUES
      ('lit', s.lit), ('indoor', s.indoor), ('wheelchair', s.wheelchair),
      ('free', s.free), ('paid', s.paid)
    ) AS c(key, cnt)
    WHERE c.cnt > 0  -- omet les critères à 0 (comme le chemin live)

    UNION ALL

    -- SURFACES : SUM des distinct-counts par surface sur les cellules.
    SELECT 'surface'::TEXT, sg.surface, SUM(sg.n)::BIGINT
    FROM mv_venue_facet_surface_grid sg
    WHERE sg.cell_x BETWEEN min_cx AND max_cx
      AND sg.cell_y BETWEEN min_cy AND max_cy
    GROUP BY sg.surface;

    RETURN;
  END IF;

  -- ── CHEMIN LIVE (au moins un filtre actif) — INCHANGÉ (cf. 0026) ───────────
  RETURN QUERY
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
END;
$$;

GRANT EXECUTE ON FUNCTION venues_facets_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
