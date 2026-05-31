-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0015 : RPC publiques en SECURITY DEFINER (#225)
-- ════════════════════════════════════════════════════════════════════════
-- Contexte sécu :
--   Les routes publiques /api/venues (modes 'pois' + 'aggregates') et
--   /api/venues/clubs utilisaient la `service_role` key (god-mode, bypass RLS)
--   dans le runtime Edge. C'était un downgrade sécurité : une clé qui bypass
--   TOUTES les policies sur TOUTES les tables transitait dans un chemin public.
--
--   La raison historique : appelées avec la clé `anon`, les RPC
--   `venues_in_bbox` / `venues_aggregates` étaient en SECURITY INVOKER (défaut
--   des fonctions SQL/plpgsql). Postgres ré-évaluait alors la policy RLS
--   `"Lecture publique des venues publiés"` (is_published = true AND
--   deleted_at IS NULL) POUR CHAQUE LIGNE candidate du scan bbox. Sur les
--   régions peu denses (grand viewport, peu de venues → gros scan GIST), cet
--   overhead par ligne faisait tomber un `statement_timeout`.
--
-- Fix :
--   On passe ces fonctions en SECURITY DEFINER. Le filtre publié/non-supprimé
--   est DÉJÀ dans le corps de chaque fonction (clauses
--   `is_published = TRUE AND deleted_at IS NULL`) → aucune fuite possible :
--   un client anon ne peut récupérer QUE des venues publiées non supprimées,
--   exactement comme la policy RLS l'exige. Mais comme la fonction s'exécute
--   désormais avec les droits du DEFINER (propriétaire = bypass RLS sur la
--   table sous-jacente), Postgres N'ÉVALUE PLUS la policy par ligne → plus
--   d'overhead → plus de timeout. La route Edge peut alors appeler ces RPC
--   avec un client `anon` (clé publique), et la `service_role` disparaît du
--   chemin public.
--
--   `SET search_path = public, pg_temp` sur chaque fonction : durcissement
--   obligatoire pour toute fonction SECURITY DEFINER (empêche un appelant de
--   détourner la résolution de noms via un schéma temporaire malveillant).
--
-- Garde-fous anti-fuite (inchangés, déjà présents avant ce fix) :
--   - is_published = TRUE        → pas de brouillon
--   - deleted_at IS NULL         → pas de soft-deleted
--   Ces deux prédicats restent codés en dur DANS chaque fonction. Le seul
--   chemin d'accès anon à `venue` est via ces RPC ; aucun SELECT direct anon.
--
-- ⚠️ APPLICATION EN PROD — peut passer par `supabase db push` / SQL Editor.
--   Tout le contenu de cette migration est transactionnel (DROP/CREATE/GRANT
--   de fonctions, pas de CREATE INDEX CONCURRENTLY) → AUCUNE contrainte
--   hors-transaction. Rejouable tel quel sur un env neuf.
--
-- ⚠️ PERF À VÉRIFIER EN PROD (pas d'accès prod côté agent) : voir la checklist
--   du body de la PR #225 (EXPLAIN sur 3 bbox, test régions peu denses sans
--   timeout, curl qu'aucun non-publié/soft-deleted ne sort).
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- 1. venues_in_bbox (mode 'pois') → SECURITY DEFINER
--    Signature identique à 0014 (9 params). On garde CREATE OR REPLACE :
--    la signature ne change pas, seul le mode de sécurité + search_path.
-- ────────────────────────────────────────────────────────────────────────

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
  primary_sport_slug  TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug
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

-- ────────────────────────────────────────────────────────────────────────
-- 2. venues_aggregates (mode 'aggregates' / clustering dézoomé) → SECURITY DEFINER
--    Signature identique à 0014. Même rationale RLS que venues_in_bbox.
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
  grid_size DOUBLE PRECISION;
BEGIN
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
      AND (fams IS NULL OR v.family_slug = ANY(fams))
      AND (sport IS NULL OR v.primary_sport_slug = sport)
    GROUP BY v.country_code;
    RETURN;
  END IF;

  IF zoom_level <= 6 THEN
    grid_size := 5.0;
  ELSIF zoom_level = 7 THEN
    grid_size := 2.0;
  ELSIF zoom_level = 8 THEN
    grid_size := 1.0;
  ELSE
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
    FLOOR(v.lat / grid_size),
    FLOOR(v.lon / grid_size);
END;
$$;

GRANT EXECUTE ON FUNCTION venues_aggregates(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT[], TEXT
) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 3. venues_global (NOUVELLE) — mode 'pois' sur bbox mondiale → SECURITY DEFINER
--    Le chemin global de /api/venues faisait un SELECT direct sur `venue`
--    (.from("venue").select(...)) sans passer par une RPC, en s'appuyant sur
--    le bypass RLS de service_role. Un SELECT direct anon retomberait dans
--    l'évaluation RLS par ligne → timeout. On encapsule donc ce SELECT
--    scalaire (sans filtre spatial, sur colonnes indexées) dans une RPC
--    SECURITY DEFINER, fidèle à la sémantique de l'ancien code (feat scalaire,
--    surface NON appliquée sur la vue mondiale).
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION venues_global(
  fams  TEXT[] DEFAULT NULL,
  sport TEXT   DEFAULT NULL,
  feat  TEXT[] DEFAULT NULL,
  max_results INTEGER DEFAULT 2000
)
RETURNS TABLE (
  id                  UUID,
  slug                TEXT,
  name                TEXT,
  lat                 DOUBLE PRECISION,
  lon                 DOUBLE PRECISION,
  family_slug         TEXT,
  primary_sport_slug  TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.slug, v.name, v.lat, v.lon, v.family_slug, v.primary_sport_slug
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND (fams IS NULL OR v.family_slug = ANY(fams))
    AND (sport IS NULL OR v.primary_sport_slug = sport)
    AND ('lit'        != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.has_lighting IS TRUE)
    AND ('indoor'     != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_indoor IS TRUE)
    AND ('wheelchair' != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.is_wheelchair_accessible IS TRUE)
    AND ('free'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS FALSE)
    AND ('paid'       != ALL(COALESCE(feat, ARRAY[]::TEXT[])) OR v.fee_required IS TRUE)
  ORDER BY v.id
  LIMIT GREATEST(1, LEAST(max_results, 5000));
$$;

GRANT EXECUTE ON FUNCTION venues_global(
  TEXT[], TEXT, TEXT[], INTEGER
) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 4. clubs_in_bbox (NOUVELLE) — /api/venues/clubs → SECURITY DEFINER
--    Remplace les SELECT directs sur `club` du handler clubs. La table `club`
--    a une policy RLS `USING (true)` (peu coûteuse), mais on encapsule quand
--    même pour (a) retirer toute dépendance service_role du chemin public et
--    (b) faire le COUNT des venues rattachés EN SQL (GROUP BY), ce qui supprime
--    la boucle de pagination JS N+1 côté route et garantit un comptage exact.
--
--    `bbox_kind` discrimine les cas gérés par parseBbox côté TS :
--      - 'global'       → pas de filtre spatial (cf. rationale historique)
--      - toute autre val → bbox simple [west,east]×[south,north]
--    L'antiméridien est splitté en 2 appels (kind != global) côté route, comme
--    avant. Le COUNT ne compte que les venues publiées non supprimées
--    (cohérent avec le badge "N courts" affiché publiquement).
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION clubs_in_bbox(
  bbox_kind TEXT,
  west  DOUBLE PRECISION DEFAULT NULL,
  south DOUBLE PRECISION DEFAULT NULL,
  east  DOUBLE PRECISION DEFAULT NULL,
  north DOUBLE PRECISION DEFAULT NULL,
  fams  TEXT[] DEFAULT NULL,
  max_results INTEGER DEFAULT 2000
)
RETURNS TABLE (
  id           UUID,
  slug         TEXT,
  name         TEXT,
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  family_slug  TEXT,
  courts_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT c.id, c.slug, c.name, c.lat, c.lon, c.family_slug
    FROM club c
    WHERE (fams IS NULL OR c.family_slug = ANY(fams))
      AND (
        bbox_kind = 'global'
        OR (
          c.lat >= south AND c.lat <= north
          AND c.lon >= west AND c.lon <= east
        )
      )
    ORDER BY c.id
    LIMIT GREATEST(1, LEAST(max_results, 5000))
  )
  SELECT
    m.id, m.slug, m.name, m.lat, m.lon, m.family_slug,
    COUNT(v.id)::BIGINT AS courts_count
  FROM matched m
  LEFT JOIN venue v
    ON v.club_id = m.id
    AND v.is_published = TRUE
    AND v.deleted_at IS NULL
  GROUP BY m.id, m.slug, m.name, m.lat, m.lon, m.family_slug;
$$;

GRANT EXECUTE ON FUNCTION clubs_in_bbox(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], INTEGER
) TO anon, authenticated;
