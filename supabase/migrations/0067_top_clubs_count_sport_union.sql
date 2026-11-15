-- ════════════════════════════════════════════════════════════════════════
-- Migration 0067 : classement clubs — compter les courts par appartenance
--                  RÉELLE au sport (primary_sport_slug ∪ venue_sport)
-- ════════════════════════════════════════════════════════════════════════
-- Bug constaté en prod (#366) : sur /disciplines/<sport>, BEAUCOUP de clubs
-- affichent « 1 court » — irréaliste pour un club. Cause : la MV (0038) comptait
--   COUNT(DISTINCT v.id) … JOIN venue_sport vs WHERE vs.sport_slug = X
-- soit UNIQUEMENT les venues ayant une ligne `venue_sport` explicite pour le
-- sport. Or l'appartenance au sport partout ailleurs (carte, pages sport/ville,
-- `mv_venue_sport_search` #476/0054) = `primary_sport_slug ∪ venue_sport`. Les
-- courts « tennis » via `primary_sport_slug` SANS ligne `venue_sport` n'étaient
-- donc pas comptés → club sous-compté (souvent à 1).
--
-- Fix : recompter avec la MÊME union que `mv_venue_sport_search`. On lit
-- `venue.club_id` EN DIRECT (et non depuis une MV éventuellement périmée après
-- un re-clustering) ; le LATERAL ne s'exécute que sur les venues rattachées à un
-- club (JOIN club) → coût borné.
--
-- Structure/colonnes/index/RPC INCHANGÉS (la page et la RPC `top_clubs_by_sport`
-- restent compatibles). Hardening 0059 préservé : pas d'accès anon/authenticated
-- direct (lecture service_role via la RPC). Refresh non-concurrent (≤ 250 lignes).
-- ════════════════════════════════════════════════════════════════════════

SET LOCAL statement_timeout = 0;

-- CASCADE drope la RPC SQL `top_clubs_by_sport` (dépendance), recréée ci-dessous.
-- La fonction de refresh (plpgsql) ne dépend pas de la MV → conservée.
DROP MATERIALIZED VIEW IF EXISTS mv_top_clubs_by_sport CASCADE;

CREATE MATERIALIZED VIEW mv_top_clubs_by_sport AS
SELECT sport_slug, club_id, club_slug, club_name, country_code, city_name, courts_count, rank
FROM (
  SELECT
    sport_slug, club_id, club_slug, club_name, country_code, city_name, courts_count,
    ROW_NUMBER() OVER (
      PARTITION BY sport_slug
      ORDER BY courts_count DESC, club_id
    ) AS rank
  FROM (
    SELECT
      m.sport_slug,
      cl.id   AS club_id,
      cl.slug AS club_slug,
      cl.name AS club_name,
      cl.country_code,
      ci.name AS city_name,
      -- Courts DU SPORT du club = venues du club appartenant au sport par
      -- primary_sport_slug OU venue_sport (même union que mv_venue_sport_search).
      COUNT(DISTINCT v.id)::INTEGER AS courts_count
    FROM venue v
    JOIN club cl ON cl.id = v.club_id
    CROSS JOIN LATERAL (
      SELECT DISTINCT sport_slug FROM (
        SELECT v.primary_sport_slug AS sport_slug
        UNION
        SELECT vs.sport_slug FROM venue_sport vs WHERE vs.venue_id = v.id
      ) u
      WHERE sport_slug IS NOT NULL
    ) m
    LEFT JOIN city ci ON ci.id = cl.city_id
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND m.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
    GROUP BY m.sport_slug, cl.id, cl.slug, cl.name, cl.country_code, ci.name
  ) counted
) ranked
WHERE rank <= 50;

CREATE UNIQUE INDEX IF NOT EXISTS mv_top_clubs_by_sport_pk
  ON mv_top_clubs_by_sport (sport_slug, club_id);
CREATE INDEX IF NOT EXISTS mv_top_clubs_by_sport_lookup
  ON mv_top_clubs_by_sport (sport_slug, rank);

-- Accès : service_role uniquement (lecture par la page Server Component) ;
-- anon/authenticated restent révoqués (hardening 0059).
REVOKE ALL ON mv_top_clubs_by_sport FROM anon, authenticated;
GRANT SELECT ON mv_top_clubs_by_sport TO service_role;

-- RPC publique recréée à l'identique (0038) + search_path figé (0059).
CREATE OR REPLACE FUNCTION top_clubs_by_sport(
  p_sport_slug TEXT,
  max_results  INTEGER DEFAULT 50
)
RETURNS TABLE (
  club_id      UUID,
  club_slug    TEXT,
  club_name    TEXT,
  country_code TEXT,
  city_name    TEXT,
  courts_count INTEGER,
  rank         BIGINT
)
LANGUAGE SQL
STABLE
SET search_path = public
AS $$
  SELECT club_id, club_slug, club_name, country_code, city_name, courts_count, rank
  FROM mv_top_clubs_by_sport
  WHERE sport_slug = p_sport_slug
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(max_results, 50));
$$;

GRANT EXECUTE ON FUNCTION top_clubs_by_sport(TEXT, INTEGER) TO anon, authenticated, service_role;

REFRESH MATERIALIZED VIEW mv_top_clubs_by_sport;

NOTIFY pgrst, 'reload schema';
