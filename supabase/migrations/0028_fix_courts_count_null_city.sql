-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0028 : corrige l'over-count courts_count (city_id NULL)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #274 (suite). Le backfill 0023 dérive courts_count en groupant par
-- (city_id, family_slug, adresse normalisée). Bug : quand city_id IS NULL,
-- PARTITION BY range TOUS les NULL dans un seul bucket. Constaté en prod :
-- 137 venues « raquette » d'adresse « le bourg » (hameau très commun), situées
-- dans 137 villages DIFFÉRENTS sans city_id, comptées comme un seul club de
-- 137 courts. Toute venue à city_id NULL + adresse générique est sur-comptée.
--
-- Ces venues ne sont pas groupables de façon fiable (pas de ville pour borner
-- la collision d'adresses) → courts_count = NULL : on n'affirme pas une donnée
-- injustifiable. Impact ranking /disciplines = NUL (la liste fait un INNER JOIN
-- city, donc les venues à city_id NULL n'y figurent jamais).
--
-- Les groupes à city_id NON NULL restent corrects (city_id ∈ clé de partition
-- → pollution confinée au bucket NULL). UPDATE ciblé, pas de recalcul global.
--
-- PROVENANCE : déjà appliqué manuellement en prod le 2026-06-02 via le pooler
-- (30 037 lignes remises à NULL, vérifié : 0 venue city_id NULL avec
-- courts_count, max 137→34). Cette migration matérialise ce correctif dans le
-- repo ; elle est idempotente (0 ligne sur un état déjà corrigé).
--
-- Numérotée 0028 : 0027 est pris par 0027_remap_family_slug.sql sur main.
-- ════════════════════════════════════════════════════════════════════════

SET LOCAL statement_timeout = 0;

UPDATE venue
SET courts_count = NULL
WHERE city_id IS NULL
  AND courts_count IS NOT NULL;
