-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0029 : top villes précalculé (vue matérialisée)
-- ════════════════════════════════════════════════════════════════════════
-- Bug : /villes (et la section "villes" de la home) vide en prod. Le RPC
-- top_cities_by_venue_count (migration 0017) timeout (57014) :
--   POST /rest/v1/rpc/top_cities_by_venue_count → 500 statement timeout.
--
-- Cause confirmée par EXPLAIN ANALYZE en prod : l'agrégat
--   GROUP BY city sur les venues publiées
-- fait un Seq Scan de ~371k venues (~30s sur cette instance). Aucun index ne
-- le sauve : ~90% des venues sont publiées → un index partiel sur
-- (city_id) WHERE is_published n'est pas sélectif, le planner garde le seq
-- scan. L'agrégat live est intrinsèquement trop lent et le restera en
-- grossissant.
--
-- Fix : on précalcule le classement dans une vue matérialisée et le RPC se
-- contente d'un SELECT trié dessus (index sur count DESC) → < 10 ms. La MV est
-- rafraîchie périodiquement par le cron /api/cron/refresh-top-cities (hebdo),
-- via refresh_top_cities_mv().
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) : ces objets ont déjà été
-- créés à chaud en prod via l'API Management pour débloquer la page ; cette
-- migration les versionne et les reconstruit à l'identique sur les envs neufs.
-- Pas de CONCURRENTLY ici → passe en transaction `db push`.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Vue matérialisée : 1 ligne par ville avec son nombre de venues publiées.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_cities_by_venue_count AS
  SELECT c.id, c.slug, c.name, c.country_code, COUNT(v.id)::BIGINT AS count
  FROM city c
  JOIN venue v ON v.city_id = c.id
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
  GROUP BY c.id, c.slug, c.name, c.country_code;

-- Index UNIQUE obligatoire pour un futur REFRESH ... CONCURRENTLY ; sert aussi
-- de clé d'accès par id. Index sur count DESC → le LIMIT du RPC est instantané.
CREATE UNIQUE INDEX IF NOT EXISTS mv_top_cities_pk
  ON mv_top_cities_by_venue_count(id);
CREATE INDEX IF NOT EXISTS mv_top_cities_count
  ON mv_top_cities_by_venue_count(count DESC);

GRANT SELECT ON mv_top_cities_by_venue_count TO anon, authenticated;

-- 2) Le RPC public lit désormais la MV au lieu d'agréger en live. Signature
-- inchangée (parité avec migration 0017) → aucun changement côté app.
CREATE OR REPLACE FUNCTION top_cities_by_venue_count(max_results INTEGER DEFAULT 6)
RETURNS TABLE (
  id           UUID,
  slug         TEXT,
  name         TEXT,
  country_code TEXT,
  count        BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT id, slug, name, country_code, count
  FROM mv_top_cities_by_venue_count
  ORDER BY count DESC
  LIMIT GREATEST(1, LEAST(max_results, 50));
$$;

GRANT EXECUTE ON FUNCTION top_cities_by_venue_count(INTEGER) TO anon, authenticated;

-- 3) Refresh de la MV. REFRESH non-concurrent : CONCURRENTLY est interdit
-- dans une fonction (contexte transactionnel) ; le job tourne hebdo hors pic
-- (lundi 07:00 UTC, après les crons d'import) → le bref AccessExclusive lock
-- est acceptable. SECURITY DEFINER pour s'exécuter avec les droits du owner.
CREATE OR REPLACE FUNCTION refresh_top_cities_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_top_cities_by_venue_count;
END;
$$;

-- Réservé au cron (service_role). Pas exposé à anon.
REVOKE ALL ON FUNCTION refresh_top_cities_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_top_cities_mv() TO service_role;
