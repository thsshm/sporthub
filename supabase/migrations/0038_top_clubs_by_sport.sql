-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0038 : classement /disciplines PAR CLUB (#366)
-- ════════════════════════════════════════════════════════════════════════
-- Le classement /disciplines basé sur les venues (MV mv_disciplines_ranking,
-- 0034/0035) remonte du bruit : les venues sont des features (« Bassin
-- Aquatique », « Court 7 »), avec adresses partagées grossières et tags
-- multi-sports parfois erronés → #1 tennis = une piscine. Constaté en prod.
--
-- Vrai fix : classer de vraies entités CLUB (table `club`, clustering #311)
-- par leur nombre de courts DU SPORT. Un club raquette n'a que des venues
-- raquette → plus de pollution inter-famille ; le nom affiché est celui du
-- club, pas d'un court isolé.
--
-- ADDITIF et NON destructif : on NE drope PAS mv_disciplines_ranking /
-- top_discipline_venues (encore utilisés par la page live tant que la nouvelle
-- n'est pas déployée). Nettoyage de l'ancien dans une migration de suivi une
-- fois la page bascule en prod.
--
-- Restreint aux 5 sports servis par la page (RANKED_SPORTS). Rafraîchi par le
-- cron /api/cron/refresh-top-clubs. Pas de CONCURRENTLY → transaction db push.
-- ════════════════════════════════════════════════════════════════════════

SET LOCAL statement_timeout = 0;

-- 1) MV : top 50 clubs par sport, classés par nombre de courts DU SPORT.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_clubs_by_sport AS
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
      vs.sport_slug,
      cl.id   AS club_id,
      cl.slug AS club_slug,
      cl.name AS club_name,
      cl.country_code,
      ci.name AS city_name,
      -- Nombre de venues DU SPORT rattachées au club (= courts du sport).
      COUNT(DISTINCT v.id)::INTEGER AS courts_count
    FROM club cl
    JOIN venue v
      ON v.club_id = cl.id
     AND v.is_published = TRUE
     AND v.deleted_at IS NULL
    JOIN venue_sport vs ON vs.venue_id = v.id
    LEFT JOIN city ci ON ci.id = cl.city_id
    WHERE vs.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
    GROUP BY vs.sport_slug, cl.id, cl.slug, cl.name, cl.country_code, ci.name
  ) counted
) ranked
WHERE rank <= 50;

CREATE UNIQUE INDEX IF NOT EXISTS mv_top_clubs_by_sport_pk
  ON mv_top_clubs_by_sport (sport_slug, club_id);
CREATE INDEX IF NOT EXISTS mv_top_clubs_by_sport_lookup
  ON mv_top_clubs_by_sport (sport_slug, rank);

GRANT SELECT ON mv_top_clubs_by_sport TO anon, authenticated;

-- 2) RPC public : top N clubs d'un sport, déjà classés. Lit la MV.
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
AS $$
  SELECT club_id, club_slug, club_name, country_code, city_name, courts_count, rank
  FROM mv_top_clubs_by_sport
  WHERE sport_slug = p_sport_slug
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(max_results, 50));
$$;

GRANT EXECUTE ON FUNCTION top_clubs_by_sport(TEXT, INTEGER) TO anon, authenticated;

-- 3) Refresh de la MV (cron hebdo). SECURITY DEFINER (droits owner).
CREATE OR REPLACE FUNCTION refresh_top_clubs_by_sport_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_top_clubs_by_sport;
END;
$$;

REVOKE ALL ON FUNCTION refresh_top_clubs_by_sport_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_top_clubs_by_sport_mv() TO service_role;
