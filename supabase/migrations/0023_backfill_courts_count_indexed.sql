-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0023 : backfill courts_count (index + UPDATE)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #274. La migration 0020 a échoué silencieusement : l'UPDATE avec une
-- window function PARTITION BY adresse sur 369k venues SANS index sur l'adresse
-- dépassait le statement_timeout par défaut → 0 ligne écrite (mais migration
-- marquée appliquée). Vérifié en prod : courts_count toujours NULL partout.
--
-- Correctif :
--   1. SET LOCAL statement_timeout = 0 : pas de limite pour CETTE transaction
--      de migration (opération ponctuelle de masse, pas un appel applicatif).
--   2. Index fonctionnel sur (city_id, family_slug, adresse normalisée) → rend
--      le regroupement rapide.
--   3. UPDATE groupé : courts_count = nombre de venues du même groupe.
--
-- Idempotent (recalcule depuis l'état des adresses). Ne touche que les venues
-- publiées, non supprimées, avec adresse non vide. Regroupe par famille.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Pas de timeout pour cette migration (opération de masse ponctuelle).
SET LOCAL statement_timeout = 0;

-- 2. Index fonctionnel sur la clé de regroupement. IMMUTABLE-safe : lower +
--    regexp_replace + btrim sont déterministes. NOT CONCURRENTLY (interdit en
--    transaction de migration ; on s'appuie sur statement_timeout=0).
CREATE INDEX IF NOT EXISTS idx_venue_courts_group
  ON venue (
    city_id,
    family_slug,
    (lower(btrim(regexp_replace(address, '\s+', ' ', 'g'))))
  )
  WHERE is_published = TRUE AND deleted_at IS NULL AND address IS NOT NULL;

-- 3. UPDATE de masse : courts_count = taille du groupe (city, famille, adresse).
WITH grouped AS (
  SELECT
    v.id,
    COUNT(*) OVER (
      PARTITION BY
        v.city_id,
        v.family_slug,
        lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
    ) AS n
  FROM venue v
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
    AND v.address IS NOT NULL
    AND btrim(v.address) <> ''
)
UPDATE venue v
SET courts_count = grouped.n
FROM grouped
WHERE v.id = grouped.id
  AND v.courts_count IS DISTINCT FROM grouped.n;
