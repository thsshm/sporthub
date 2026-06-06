-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0036 : restaure mv_disciplines_ranking (état #358)
-- ════════════════════════════════════════════════════════════════════════
-- Revert de 0035 (#366). Le passage au comptage PAR SPORT a fait remonter en
-- tête des venues aberrantes (ex. « Bassin Aquatique » #1 en tennis avec 37
-- courts) : le modèle de données (venues = features individuelles, noms de
-- court, adresses partagées grossières par les gros complexes municipaux,
-- tags multi-sports parfois erronés) fait que compter par sport SUR CES
-- GROUPES remonte du bruit. C'est un problème de qualité de données, pas
-- d'arithmétique — à traiter proprement dans #366 (meilleure identification
-- de club + filtre famille + choix du représentant), pas en l'état.
--
-- On restaure donc la définition de #358 (migration 0034), connue et correcte
-- en prod (classement par venue.courts_count, top 50 par sport). Identique à
-- 0034 — colonnes, RPC, index, grants inchangés.
-- ════════════════════════════════════════════════════════════════════════

SET LOCAL statement_timeout = 0;

DROP FUNCTION IF EXISTS top_discipline_venues(TEXT, INTEGER);
DROP MATERIALIZED VIEW IF EXISTS mv_disciplines_ranking;

CREATE MATERIALIZED VIEW mv_disciplines_ranking AS
  SELECT sport_slug, id, slug, name, address, country_code, courts_count, city_name, rank
  FROM (
    SELECT
      vs.sport_slug,
      v.id,
      v.slug,
      v.name,
      v.address,
      v.country_code,
      v.courts_count,
      c.name AS city_name,
      ROW_NUMBER() OVER (
        PARTITION BY vs.sport_slug
        ORDER BY v.courts_count DESC, v.id
      ) AS rank
    FROM venue v
    JOIN venue_sport vs ON vs.venue_id = v.id
    LEFT JOIN city c ON c.id = v.city_id
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND v.courts_count IS NOT NULL
      AND v.courts_count > 0
  ) ranked
  WHERE rank <= 50;

CREATE UNIQUE INDEX IF NOT EXISTS mv_disciplines_ranking_pk
  ON mv_disciplines_ranking (sport_slug, id);
CREATE INDEX IF NOT EXISTS mv_disciplines_ranking_lookup
  ON mv_disciplines_ranking (sport_slug, rank);

GRANT SELECT ON mv_disciplines_ranking TO anon, authenticated;

CREATE OR REPLACE FUNCTION top_discipline_venues(
  p_sport_slug TEXT,
  max_results  INTEGER DEFAULT 50
)
RETURNS TABLE (
  id            UUID,
  slug          TEXT,
  name          TEXT,
  address       TEXT,
  country_code  TEXT,
  courts_count  INTEGER,
  city_name     TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT id, slug, name, address, country_code, courts_count, city_name
  FROM mv_disciplines_ranking
  WHERE sport_slug = p_sport_slug
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(max_results, 50));
$$;

GRANT EXECUTE ON FUNCTION top_discipline_venues(TEXT, INTEGER) TO anon, authenticated;
