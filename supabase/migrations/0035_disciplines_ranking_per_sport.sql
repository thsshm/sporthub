-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0035 : classement disciplines compté PAR SPORT
-- ════════════════════════════════════════════════════════════════════════
-- Issue #366 (suite de #331 / MV 0034).
--
-- Bug : la MV `mv_disciplines_ranking` (0034) classe par `venue.courts_count`,
-- une valeur comptée PAR FAMILLE (backfill 0023 : taille du groupe
-- `city_id, family_slug, adresse`). Un club tennis+padel à la même adresse voit
-- donc ses courts de tennis ET de padel additionnés, et le même chiffre gonflé
-- apparaît sur /disciplines/tennis ET /disciplines/padel. De plus, la MV 0034
-- ne déduplique pas : un club à N venues = N lignes (quasi) identiques.
--
-- Fix (migration seule — RPC `top_discipline_venues` et cron
-- `refresh_disciplines_ranking_mv` INCHANGÉS, mêmes colonnes/grants) :
--   1. courts_count = COUNT(*) OVER (PARTITION BY sport_slug, city_id, adresse
--      normalisée) → comptage PAR SPORT (les terrains de tennis du club, pas
--      ceux de padel). Cast ::INTEGER pour rester compatible avec le type de
--      retour du RPC (courts_count INTEGER).
--   2. Déduplication à 1 ligne par club réel (sport, ville, adresse) via
--      ROW_NUMBER()=1 → le classement liste des clubs distincts.
--   3. Venues sans city_id / adresse exclues (club non identifiable de façon
--      fiable, cf. 0031) — l'identité « club » repose sur (ville, adresse).
--   4. Restreint aux sports servis par la page (RANKED_SPORTS du composant
--      app/[locale]/disciplines/[sport]/page.tsx) → MV plus petite, refresh plus
--      rapide. COUPLAGE à garder en phase : si RANKED_SPORTS évolue côté app,
--      mettre à jour la liste ci-dessous (ou créer une migration de suivi).
--
-- Idempotent. Une MV ne se CREATE OR REPLACE pas → DROP + CREATE. Le RPC est en
-- SQL à liaison tardive (aucune dépendance pg_depend sur la MV) → le DROP ne le
-- casse pas et il repointe la MV recréée dans la même transaction.
-- Pas de CONCURRENTLY → passe en transaction `db push`.
-- ════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_disciplines_ranking;

CREATE MATERIALIZED VIEW mv_disciplines_ranking AS
  WITH per_sport AS (
    SELECT
      vs.sport_slug,
      v.id,
      v.slug,
      v.name,
      v.address,
      v.country_code,
      c.name AS city_name,
      -- Nombre de venues du MÊME sport au même club (ville + adresse normalisée).
      COUNT(*) OVER (
        PARTITION BY
          vs.sport_slug,
          v.city_id,
          lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
      )::INTEGER AS courts_count,
      -- 1 ligne représentative par club réel (sport, ville, adresse).
      ROW_NUMBER() OVER (
        PARTITION BY
          vs.sport_slug,
          v.city_id,
          lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
        ORDER BY v.id
      ) AS dedup_rn
    FROM venue v
    JOIN venue_sport vs ON vs.venue_id = v.id
    LEFT JOIN city c ON c.id = v.city_id
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND vs.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
      AND v.city_id IS NOT NULL
      AND v.address IS NOT NULL
      AND btrim(v.address) <> ''
  ),
  clubs AS (
    SELECT sport_slug, id, slug, name, address, country_code, city_name, courts_count
    FROM per_sport
    WHERE dedup_rn = 1
  ),
  ranked AS (
    SELECT
      sport_slug, id, slug, name, address, country_code, courts_count, city_name,
      ROW_NUMBER() OVER (
        PARTITION BY sport_slug
        ORDER BY courts_count DESC, id
      ) AS rank
    FROM clubs
  )
  SELECT sport_slug, id, slug, name, address, country_code, courts_count, city_name, rank
  FROM ranked
  WHERE rank <= 50;

-- Index UNIQUE (clé + futur REFRESH … CONCURRENTLY) et index de lecture.
CREATE UNIQUE INDEX IF NOT EXISTS mv_disciplines_ranking_pk
  ON mv_disciplines_ranking (sport_slug, id);
CREATE INDEX IF NOT EXISTS mv_disciplines_ranking_lookup
  ON mv_disciplines_ranking (sport_slug, rank);

GRANT SELECT ON mv_disciplines_ranking TO anon, authenticated;
