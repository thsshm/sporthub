-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0034 : classement disciplines précalculé (MV)
-- ════════════════════════════════════════════════════════════════════════
-- Bug #331 : les pages /disciplines/{sport} (classement national des clubs par
-- nombre de courts) ramenaient 0 club. `fetchRanking` faisait :
--   SELECT … FROM venue JOIN venue_sport(!inner) … ORDER BY courts_count DESC
-- Sur un gros sport (tennis ≈ 40k venues après le inner join), le tri par
-- `venue.courts_count` — colonne NON indexée — force un seq scan + sort qui
-- dépasse le statement_timeout du rôle PostgREST (57014). Confirmé en prod :
--   GET /venue?…&venue_sport.sport_slug=eq.tennis&order=courts_count.desc
--   → {"code":"57014","message":"canceling statement due to statement timeout"}
-- La requête échoue → `catch` → `[]` → page vide.
--
-- Le contournement #352 (ORDER BY id + tri en mémoire des 50 premiers) ne
-- timeoute plus mais ne classe PAS : il ramène 50 venues arbitraires (plus
-- petits id) au lieu du vrai top-N par courts. La donnée existe pourtant
-- (backfill courts_count #274 fait, ex. clubs tennis RES à 7+ courts).
--
-- Fix : on précalcule le top 50 par sport dans une vue matérialisée et le RPC
-- public se contente d'un SELECT trié dessus (index sur (sport_slug, rank)) →
-- < 10 ms, et c'est le VRAI classement. La MV est rafraîchie par le cron
-- /api/cron/refresh-disciplines (hebdo) via refresh_disciplines_ranking_mv().
-- Même pattern que mv_top_cities_by_venue_count (migration 0029, #328).
--
-- Pas de CONCURRENTLY ici → passe en transaction `db push`. Le filtre
-- courts_count IS NOT NULL restreint au sous-ensemble court-compté (petit), donc
-- même le build initial de la MV reste raisonnable malgré le seq scan venue.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════

-- 1) Vue matérialisée : top 50 clubs par sport, triés par nombre de courts.
--    Calculée pour TOUS les sports (découplé de RANKED_SPORTS côté app) ; seuls
--    les venues avec un courts_count connu (> 0) entrent dans un « classement
--    par nombre de courts ».
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_disciplines_ranking AS
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

-- Index UNIQUE (obligatoire pour un futur REFRESH … CONCURRENTLY ; sert aussi de
-- clé). Index de lecture (sport_slug, rank) → le SELECT trié du RPC est instantané.
CREATE UNIQUE INDEX IF NOT EXISTS mv_disciplines_ranking_pk
  ON mv_disciplines_ranking (sport_slug, id);
CREATE INDEX IF NOT EXISTS mv_disciplines_ranking_lookup
  ON mv_disciplines_ranking (sport_slug, rank);

GRANT SELECT ON mv_disciplines_ranking TO anon, authenticated;

-- 2) RPC public : top N venues d'une discipline, déjà classés. Lit la MV.
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

-- 3) Refresh de la MV. REFRESH non-concurrent (CONCURRENTLY interdit dans une
--    fonction au contexte transactionnel) ; le cron tourne hebdo hors pic
--    (lundi 08:00 UTC, après refresh-top-cities) → le bref AccessExclusive lock
--    sur la MV est sans impact notable. SECURITY DEFINER pour les droits owner.
CREATE OR REPLACE FUNCTION refresh_disciplines_ranking_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_disciplines_ranking;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_disciplines_ranking_mv() TO service_role;
