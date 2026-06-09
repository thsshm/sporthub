-- 0053 — Colonne `quality_score` stockée sur `venue` (#464).
--
-- Pourquoi : le score de complétude/confiance 0–100 vivait uniquement en TS
-- (`lib/venue/quality-score.ts`, `venueQualityScore`) et était recalculé à la
-- volée. Ça suffit pour le noindex des fiches (#490), le sitemap (#513) et les
-- listes ville bornées (#520). Mais la page nationale `/sports/[sport]` est
-- trop volumineuse pour un fetch-all + filtre JS : il lui faut filtrer/paginer
-- en SQL → d'où une colonne queryable.
--
-- Comment : colonne GÉNÉRÉE STORED → Postgres la calcule à l'insert/update,
-- TOUJOURS synchro, AUCUN backfill ni cron à maintenir. L'ALTER calcule la
-- valeur pour toutes les lignes existantes (réécriture de table ponctuelle :
-- lock ACCESS EXCLUSIVE le temps de la réécriture des ~371k lignes — à lancer
-- hors pic ; quelques secondes à ~1 min).
--
-- ⚠️ SOURCE DE VÉRITÉ DUPLIQUÉE : l'expression ci-dessous DOIT rester alignée
-- sur les `WEIGHTS` et conditions de `lib/venue/quality-score.ts`
-- (`venueQualityScore`). Si tu changes un poids/condition côté TS, mets à jour
-- cette colonne (nouvelle migration). Un test JS↔SQL garde-fou accompagne ce
-- changement. Divergences ASSUMÉES et mineures :
--   - `city` : le TS compte aussi `city_name` (issu d'un join, pas une colonne
--     de `venue`) ; ici on ne dispose que de `city_id` sur la ligne.
--
-- Poids (somme = 100) : address 20, city 10, website 15, phone 10,
--                       description 12, photo 10, rating 8, verified 10, sport 5.

ALTER TABLE venue
  ADD COLUMN IF NOT EXISTS quality_score smallint
  GENERATED ALWAYS AS (
      (CASE WHEN address IS NOT NULL AND btrim(address) <> '' THEN 20 ELSE 0 END)
    + (CASE WHEN city_id IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN website_url IS NOT NULL AND btrim(website_url) <> '' THEN 15 ELSE 0 END)
    + (CASE WHEN phone IS NOT NULL AND btrim(phone) <> '' THEN 10 ELSE 0 END)
    + (CASE
         WHEN (description IS NOT NULL AND btrim(description) <> '')
           OR (enrichments ->> 'description' IS NOT NULL
               AND btrim(enrichments ->> 'description') <> '')
         THEN 12 ELSE 0
       END)
    + (CASE
         WHEN enrichments ->> 'photo_url' IS NOT NULL
           AND btrim(enrichments ->> 'photo_url') <> ''
         THEN 10 ELSE 0
       END)
    + (CASE
         -- guard regex avant cast : enrichments JSONB peut contenir n'importe
         -- quoi → évite une erreur de cast qui ferait échouer toute la réécriture.
         WHEN (enrichments ->> 'google_rating') ~ '^[0-9]+(\.[0-9]+)?$'
           AND (enrichments ->> 'google_rating')::numeric > 0
           AND (enrichments ->> 'google_rating_count') ~ '^[0-9]+$'
           AND (enrichments ->> 'google_rating_count')::numeric > 0
         THEN 8 ELSE 0
       END)
    + (CASE WHEN claim_status = 'verified' THEN 10 ELSE 0 END)
    + (CASE WHEN primary_sport_slug IS NOT NULL AND btrim(primary_sport_slug) <> '' THEN 5 ELSE 0 END)
  ) STORED;

COMMENT ON COLUMN venue.quality_score IS
  'Score de complétude/confiance 0-100 (généré STORED). Miroir SQL de lib/venue/quality-score.ts:venueQualityScore (#464). Seuil indexable = 25.';

-- Expose la nouvelle colonne via l'API PostgREST (sinon absente du schéma cache).
NOTIFY pgrst, 'reload schema';
