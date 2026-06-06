-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0035 : top clubs par sport (vue matérialisée)
-- ════════════════════════════════════════════════════════════════════════
-- Bug #331 : toutes les pages /disciplines/{sport} affichaient « 0 clubs ».
-- Cause confirmée en prod (pas « courts_count NULL partout » — la colonne est
-- peuplée depuis 0023/0031) : la requête de la page triait le gros set joint
-- `venue ⋈ venue_sport(sport)` par `venue.courts_count`, colonne NON INDEXÉE.
-- Le planner ne peut pas satisfaire `ORDER BY courts_count … LIMIT` par index
-- → tri full-scan sur la jointure → statement_timeout (57014) → `catch → []`
-- → page vide figée en cache ISR. Reproduit en prod, y compris sur un petit
-- sport (squash), donc ni le volume ni une colonne vide : c'est le tri.
--
-- Même panne et même remède que 0029 (mv_top_cities_by_venue_count) : on
-- précalcule le classement dans une vue matérialisée (build avec
-- statement_timeout = 0) et le RPC public se contente d'un SELECT trié indexé
-- → < 10 ms. Rafraîchie par le cron /api/cron/refresh-top-clubs.
--
-- Comptage PAR SPORT (pas par famille) : courts_count = nombre de venues de CE
-- sport au même club (même ville + adresse normalisée), via une window
-- COUNT(*) OVER (sport_slug, city_id, adresse). Un club tennis+padel compte
-- donc ses courts de tennis et ses courts de padel séparément — c'est ce qu'on
-- veut sur une page « meilleurs clubs de {sport} ». On ne s'appuie plus sur
-- venue.courts_count (0023, qui comptait par FAMILLE) : on recompte ici.
--
-- Déduplication : une page « meilleurs clubs » ne doit pas répéter les N courts
-- d'un même club → on réduit à UNE ligne par club réel (sport, ville, adresse).
-- Les venues sans city_id ou sans adresse sont exclues : club non identifiable
-- de façon fiable (cf. la sur-comptabilisation « le bourg » corrigée en 0031).
--
-- Restreint aux 5 sports raquette servis par la page (RANKED_SPORTS) pour
-- garder la MV petite. Idempotent (IF NOT EXISTS / CREATE OR REPLACE).
-- Pas de CONCURRENTLY ici → passe en transaction `db push`.
-- ════════════════════════════════════════════════════════════════════════

-- Opération de masse ponctuelle : pas de timeout pour CETTE transaction.
SET LOCAL statement_timeout = 0;

-- 1) Vue matérialisée : 1 ligne par club, classée par nombre de courts (desc),
--    partitionnée par sport.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_clubs_by_sport AS
WITH ranked AS (
  SELECT
    vs.sport_slug,
    v.id,
    v.slug,
    v.name,
    v.address,
    v.country_code,
    v.city_id,
    lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g'))) AS addr_key,
    -- Nombre de courts DE CE SPORT au même club (ville + adresse), par sport.
    COUNT(*) OVER (
      PARTITION BY
        vs.sport_slug,
        v.city_id,
        lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
    ) AS courts_count
  FROM venue v
  JOIN venue_sport vs ON vs.venue_id = v.id
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.city_id IS NOT NULL
    AND v.address IS NOT NULL
    AND btrim(v.address) <> ''
    AND vs.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
),
-- Un représentant par club réel (sport, ville, adresse). Tous les venues d'un
-- groupe portent le même courts_count (window) → le représentant est arbitraire.
dedup AS (
  SELECT DISTINCT ON (sport_slug, city_id, addr_key)
    sport_slug, id, slug, name, address, country_code, courts_count, city_id
  FROM ranked
  ORDER BY sport_slug, city_id, addr_key, id
)
SELECT
  d.sport_slug,
  d.id,
  d.slug,
  d.name,
  d.address,
  d.country_code,
  d.courts_count::INTEGER AS courts_count,
  c.name AS city_name,
  row_number() OVER (
    PARTITION BY d.sport_slug
    ORDER BY d.courts_count DESC, d.id
  ) AS rank
FROM dedup d
LEFT JOIN city c ON c.id = d.city_id;

-- Index UNIQUE (obligatoire pour un futur REFRESH … CONCURRENTLY) + clé d'accès.
CREATE UNIQUE INDEX IF NOT EXISTS mv_top_clubs_by_sport_pk
  ON mv_top_clubs_by_sport (sport_slug, rank);

-- Le RPC lit WHERE sport_slug = $1 ORDER BY rank → cet index rend le LIMIT
-- instantané.
CREATE INDEX IF NOT EXISTS mv_top_clubs_by_sport_lookup
  ON mv_top_clubs_by_sport (sport_slug, rank);

GRANT SELECT ON mv_top_clubs_by_sport TO anon, authenticated;

-- 2) RPC public : lit la MV au lieu d'agréger/trier en live.
CREATE OR REPLACE FUNCTION top_clubs_by_sport(
  p_sport_slug TEXT,
  max_results INTEGER DEFAULT 50
)
RETURNS TABLE (
  id            UUID,
  slug         TEXT,
  name         TEXT,
  address      TEXT,
  country_code TEXT,
  courts_count INTEGER,
  city_name    TEXT,
  rank         BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT id, slug, name, address, country_code, courts_count, city_name, rank
  FROM mv_top_clubs_by_sport
  WHERE sport_slug = p_sport_slug
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(max_results, 200));
$$;

GRANT EXECUTE ON FUNCTION top_clubs_by_sport(TEXT, INTEGER) TO anon, authenticated;

-- 3) Refresh de la MV. REFRESH non-concurrent (CONCURRENTLY interdit dans une
--    fonction). Tourne hebdo hors pic via le cron. SECURITY DEFINER pour
--    s'exécuter avec les droits du owner.
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

-- Réservé au cron (service_role). Pas exposé à anon.
REVOKE ALL ON FUNCTION refresh_top_clubs_by_sport_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_top_clubs_by_sport_mv() TO service_role;
