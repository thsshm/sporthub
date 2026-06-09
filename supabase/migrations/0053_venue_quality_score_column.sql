-- Colonne quality_score sur venue (#464) — score de complétude/confiance 0–100.
--
-- Permet de filtrer en SQL (et donc paginer proprement) les pages qui *listent*
-- des venues à grande échelle, en premier lieu la page nationale
-- `/sports/[sport]` (ex. tennis = 67k venues → fetch-all + filtre JS impossible).
--
-- ⚠️ SOURCE DE VÉRITÉ PARTAGÉE : cette formule SQL doit rester un miroir EXACT
-- de `venueQualityScore` dans `lib/venue/quality-score.ts` (mêmes poids, même
-- seuil LOW_QUALITY_THRESHOLD=25). Toute modif d'un côté doit être répliquée de
-- l'autre. Poids : adresse 20 · ville 10 · site 15 · tél 10 · description 12 ·
-- photo 10 · rating 8 · claim vérifié 10 · sport 5  (somme = 100).
--
-- Colonne GENERATED STORED : toujours cohérente (recalculée par Postgres à
-- chaque write), aucun backfill ni trigger. L'ajout réécrit la table une fois
-- (lock bref) — acceptable : la V2 n'est pas encore le site public (V1 reste
-- live sur sporthubmap.com).
--
-- Idempotent (IF NOT EXISTS) : sûr à ré-appliquer (appliqué hors db-push via le
-- SQL Editor, puis re-joué tel quel au prochain db-push).

ALTER TABLE venue
  ADD COLUMN IF NOT EXISTS quality_score smallint
  GENERATED ALWAYS AS (
      (CASE WHEN address IS NOT NULL AND btrim(address) <> '' THEN 20 ELSE 0 END)
    + (CASE WHEN city_id IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN website_url IS NOT NULL AND btrim(website_url) <> '' THEN 15 ELSE 0 END)
    + (CASE WHEN phone IS NOT NULL AND btrim(phone) <> '' THEN 10 ELSE 0 END)
    + (CASE WHEN (description IS NOT NULL AND btrim(description) <> '')
              OR (enrichments ->> 'description' IS NOT NULL
                  AND btrim(enrichments ->> 'description') <> '')
            THEN 12 ELSE 0 END)
    + (CASE WHEN enrichments ->> 'photo_url' IS NOT NULL
              AND btrim(enrichments ->> 'photo_url') <> ''
            THEN 10 ELSE 0 END)
    + (CASE WHEN jsonb_typeof(enrichments -> 'google_rating') = 'number'
              AND jsonb_typeof(enrichments -> 'google_rating_count') = 'number'
            THEN (CASE WHEN (enrichments ->> 'google_rating')::numeric > 0
                        AND (enrichments ->> 'google_rating_count')::numeric > 0
                      THEN 8 ELSE 0 END)
            ELSE 0 END)
    + (CASE WHEN claim_status::text = 'verified' THEN 10 ELSE 0 END)
    + (CASE WHEN primary_sport_slug IS NOT NULL
              AND btrim(primary_sport_slug) <> ''
            THEN 5 ELSE 0 END)
  ) STORED;

COMMENT ON COLUMN venue.quality_score IS
  'Score qualité 0-100 (miroir SQL de lib/venue/quality-score.ts). Seuil indexable = 25 (#464).';

-- Recharger le cache de schéma PostgREST pour exposer la nouvelle colonne à l'API.
NOTIFY pgrst, 'reload schema';
