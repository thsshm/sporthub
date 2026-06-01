-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0020 : backfill venue.courts_count (en masse, SQL)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #274 (prérequis du ranking /disciplines #265).
--
-- Contexte : courts_count était rempli sur ~0% des venues. Or les courts d'un
-- même club partagent une adresse (ex. 17 venues « COURT DE TENNIS … 1/2/3 »
-- à la même adresse = 17 courts). On dérive courts_count = nombre de venues du
-- même groupe (city_id, family_slug, adresse normalisée).
--
-- Pourquoi en SQL et pas via le script Python (scripts/backfill_courts_count.py) :
-- 268k UPDATE via l'API REST PostgREST timeout en boucle (statement_timeout).
-- Un seul UPDATE … FROM (…) côté serveur fait tout le travail en une passe,
-- via l'index venue(city_id) — robuste et rapide.
--
-- Idempotent : relançable (recalcule depuis l'état courant des adresses). Ne
-- touche QUE les venues publiées, non supprimées, avec une adresse non vide.
-- Regroupe PAR FAMILLE : un complexe multisport ne compte pas ses terrains de
-- foot comme des courts de tennis (granularité « courts » = par discipline).
-- ════════════════════════════════════════════════════════════════════════

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
