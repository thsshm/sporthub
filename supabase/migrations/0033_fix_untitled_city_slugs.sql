-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0033 : corrige les slugs de ville « untitled »
-- ════════════════════════════════════════════════════════════════════════
-- Bug repéré via /villes (RPC top_cities_by_venue_count) : la ville #1 du
-- classement (Άγιοι Ανάργυροι, GR, 4554 venues) avait slug = « untitled », donc
-- sa carte pointait vers /map?city=untitled — filtre cassé (fetchCityCenter
-- résout `WHERE slug = ? LIMIT 1`, ambigu quand plusieurs villes partagent
-- « untitled »).
--
-- Cause : slugify() strippe tout caractère non-ASCII (NFKD + suppression). Pour
-- un nom 100% non-latin (grec, cyrillique, arabe, CJK…), la chaîne devient vide
-- → fallback « untitled ». 12 villes concernées, chacune dans un pays distinct
-- (la clé UNIQUE est (country_code, slug), d'où 12 « untitled » coexistants).
--
-- Fix : on réécrit le slug avec la translittération latine standard du nom. On
-- cible par (country_code, slug='untitled') — sûr car 1 seule untitled par pays
-- dans ce lot. Idempotent : relançable (0 ligne une fois corrigé) ; no-op sur
-- les envs neufs/seed (ces villes n'y existent pas).
--
-- NB : la racine (slugify côté import) vit dans le pipeline V1 (data-pipeline/,
-- read-only) → non corrigée ici. À traiter séparément (normaliseur post-import
-- avec translittération). TN « أريانة » est EXCLUE : son slug cible « ariana »
-- existe déjà (doublon de la ville « Ariana ») → à fusionner, pas à renommer.
-- ════════════════════════════════════════════════════════════════════════

UPDATE city SET slug = 'agioi-anargyroi' WHERE country_code = 'GR' AND slug = 'untitled';
UPDATE city SET slug = 'asenovgrad'      WHERE country_code = 'BG' AND slug = 'untitled';
UPDATE city SET slug = 'jagodina'        WHERE country_code = 'RS' AND slug = 'untitled';
UPDATE city SET slug = 'setagaya-ku'     WHERE country_code = 'JP' AND slug = 'untitled';
UPDATE city SET slug = 'ivano-frankivsk' WHERE country_code = 'UA' AND slug = 'untitled';
UPDATE city SET slug = 'ouled-fayet'     WHERE country_code = 'DZ' AND slug = 'untitled';
UPDATE city SET slug = 'bitola'          WHERE country_code = 'MK' AND slug = 'untitled';
UPDATE city SET slug = 'vyborgsky-rayon' WHERE country_code = 'RU' AND slug = 'untitled';
UPDATE city SET slug = 'mdiq'            WHERE country_code = 'MA' AND slug = 'untitled';
UPDATE city SET slug = 'dali'            WHERE country_code = 'CY' AND slug = 'untitled';
UPDATE city SET slug = 'brest'           WHERE country_code = 'BY' AND slug = 'untitled';

-- Rafraîchir la MV qui alimente /villes (sinon les anciens slugs restent figés).
REFRESH MATERIALIZED VIEW mv_top_cities_by_venue_count;
