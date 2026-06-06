-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0035 : classement disciplines compté PAR SPORT
-- ════════════════════════════════════════════════════════════════════════
-- Suite #331 / #366. La MV mv_disciplines_ranking (0034, #358) classe par
-- `venue.courts_count`, un comptage par FAMILLE (taille du groupe city_id +
-- family_slug + adresse, défini au backfill 0023). Conséquence : un club
-- tennis+padel au même endroit additionne ses courts de tennis ET de padel sur
-- /disciplines/tennis comme sur /disciplines/padel. On veut un comptage PAR
-- SPORT.
--
-- On redéfinit la MV (mêmes colonnes, donc le RPC `top_discipline_venues` et la
-- page restent inchangés) :
--   1. courts_count = COUNT(*) OVER (sport_slug, city_id, adresse normalisée)
--      → nombre de venues DE CE SPORT au même club.
--   2. Déduplication à 1 ligne par club réel (sport, ville, adresse) : sans ça,
--      un club de 6 courts donnerait 6 lignes identiques « 6 courts ».
--   3. Venues sans city_id ou sans adresse exclues (club non identifiable de
--      façon fiable — cf. la sur-comptabilisation « le bourg » corrigée en 0031).
--   4. Restreint aux 5 sports servis par la page (RANKED_SPORTS) → MV plus
--      petite, build et refresh hebdo plus rapides.
--
-- Le RPC `top_discipline_venues` (LANGUAGE SQL) a une dépendance sur la MV : on
-- le DROP puis le recrée À L'IDENTIQUE (même signature/colonnes). La fonction
-- de refresh (plpgsql, nom résolu au runtime) n'a pas de dépendance → conservée.
-- Pas de CONCURRENTLY → passe en transaction `db push`. Idempotent au sens où
-- un re-run reconstruit l'état cible (DROP IF EXISTS / CREATE).
-- ════════════════════════════════════════════════════════════════════════

-- Build de masse ponctuel : pas de timeout pour CETTE transaction.
SET LOCAL statement_timeout = 0;

-- Le RPC SQL dépend de la MV → le retirer avant de reconstruire la MV.
DROP FUNCTION IF EXISTS top_discipline_venues(TEXT, INTEGER);
-- Les index tombent avec la MV.
DROP MATERIALIZED VIEW IF EXISTS mv_disciplines_ranking;

-- 1) MV redéfinie : top 50 clubs par sport, comptés PAR SPORT, dédupliqués.
CREATE MATERIALIZED VIEW mv_disciplines_ranking AS
SELECT sport_slug, id, slug, name, address, country_code, courts_count, city_name, rank
FROM (
  SELECT
    sport_slug, id, slug, name, address, country_code, courts_count, city_name,
    ROW_NUMBER() OVER (
      PARTITION BY sport_slug
      ORDER BY courts_count DESC, id
    ) AS rank
  FROM (
    -- Un représentant par club réel (sport, ville, adresse). Toutes les venues
    -- d'un groupe portent le même courts_count (window) → représentant arbitraire.
    SELECT DISTINCT ON (sport_slug, city_id, addr_key)
      sport_slug, id, slug, name, address, country_code, city_name, courts_count
    FROM (
      SELECT
        vs.sport_slug,
        v.id,
        v.slug,
        v.name,
        v.address,
        v.country_code,
        v.city_id,
        c.name AS city_name,
        lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g'))) AS addr_key,
        -- Nombre de courts DE CE SPORT au même club (ville + adresse).
        COUNT(*) OVER (
          PARTITION BY
            vs.sport_slug,
            v.city_id,
            lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
        )::INTEGER AS courts_count
      FROM venue v
      JOIN venue_sport vs ON vs.venue_id = v.id
      LEFT JOIN city c ON c.id = v.city_id
      WHERE v.is_published = TRUE
        AND v.deleted_at IS NULL
        AND v.city_id IS NOT NULL
        AND v.address IS NOT NULL
        AND btrim(v.address) <> ''
        AND vs.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
    ) base
    ORDER BY sport_slug, city_id, addr_key, id
  ) dedup
) ranked
WHERE rank <= 50;

-- Index identiques à 0034 (UNIQUE pour REFRESH CONCURRENTLY futur + clé ; lecture).
CREATE UNIQUE INDEX IF NOT EXISTS mv_disciplines_ranking_pk
  ON mv_disciplines_ranking (sport_slug, id);
CREATE INDEX IF NOT EXISTS mv_disciplines_ranking_lookup
  ON mv_disciplines_ranking (sport_slug, rank);

GRANT SELECT ON mv_disciplines_ranking TO anon, authenticated;

-- 2) RPC recréé À L'IDENTIQUE (signature + colonnes inchangées → page/types OK).
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

-- 3) Fonction de refresh inchangée (0034) — REFRESH résout le nom au runtime,
--    donc reconstruire la MV sous le même nom la garde valide. Rien à faire ici.
