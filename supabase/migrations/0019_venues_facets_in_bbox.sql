-- Compteurs à facettes pour le panneau de filtres (#269 suite — restitution V1).
--
-- Pour chaque option de filtre du panneau gauche (famille / critère / surface),
-- on veut afficher le nombre de lieux du viewport courant qui matcheraient si on
-- (dé)cochait cette option, en respectant les AUTRES groupes de filtres actifs.
-- C'est la sémantique "faceted search" (style Amazon) : on ignore la sélection
-- du groupe courant mais on applique les filtres des autres groupes, ce qui
-- évite les culs-de-sac (on voit toujours ce qu'un clic apporterait).
--
-- Sémantique par groupe :
--   - family   : compte par family_slug, en appliquant feat + surfaces (PAS fams)
--   - criteria : compte par critère, en appliquant fams + surfaces + LES AUTRES
--                critères actifs (un critère ignore sa propre sélection)
--   - surface  : compte par surface, en appliquant fams + feat (PAS surfaces)
--
-- Mêmes filtres de base que venues_in_bbox (0016) : bbox spatiale, is_published,
-- deleted_at IS NULL. Mêmes valeurs canoniques (#99) : critères lit/indoor/
-- wheelchair/free/paid ; surfaces clay/concrete/synthetic/grass/parquet/sand.
--
-- Retour : lignes (facet_type, facet_key, n). Le client pivote en 3 maps.
-- Pas de max_results : on agrège (COUNT), on ne matérialise pas les POI.

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
  -- Base spatiale commune : tous les lieux publiés du viewport.
  base AS (
    SELECT v.id, v.family_slug, v.has_lighting, v.is_indoor,
           v.is_wheelchair_accessible, v.fee_required
    FROM venue v
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND v.geom && ST_MakeEnvelope(west, south, east, north, 4326)::geography
  ),
  -- Helper : un lieu satisfait-il TOUS les critères d'une liste donnée ?
  -- (réutilisé via expressions inline ci-dessous, pas de fonction séparée)
  -- Surface match : au moins un sport joué sur l'une des surfaces demandées.
  base_surf AS (
    SELECT b.*,
      (surfaces IS NULL OR EXISTS (
        SELECT 1 FROM venue_sport vs
        WHERE vs.venue_id = b.id AND vs.surface = ANY(surfaces)
      )) AS match_surfaces
    FROM base b
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
  -- Pour chaque critère k, on compte les lieux qui le portent ET qui satisfont
  -- tous les autres critères sélectionnés (on retire k de la liste appliquée).
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
    -- autres critères actifs (tous sauf k) doivent matcher
    AND ('lit'        = k.key OR 'lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.has_lighting IS TRUE)
    AND ('indoor'     = k.key OR 'indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_indoor IS TRUE)
    AND ('wheelchair' = k.key OR 'wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.is_wheelchair_accessible IS TRUE)
    AND ('free'       = k.key OR 'free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS FALSE)
    AND ('paid'       = k.key OR 'paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR bs.fee_required IS TRUE)
  GROUP BY k.key

  UNION ALL

  -- ── SURFACES : applique fams + feat, ignore surfaces ──────────────────────
  -- Compte par surface distincte présente sur les lieux du viewport (via
  -- venue_sport). Un lieu peut compter dans plusieurs surfaces (multi-sports).
  SELECT 'surface'::TEXT, vs.surface, COUNT(DISTINCT b.id)::BIGINT
  FROM base b
  JOIN venue_sport vs ON vs.venue_id = b.id
  WHERE vs.surface IS NOT NULL
    AND (fams IS NULL OR b.family_slug = ANY(fams))
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR b.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR b.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR b.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR b.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR b.fee_required IS TRUE)
  GROUP BY vs.surface;
$$;

GRANT EXECUTE ON FUNCTION venues_facets_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
