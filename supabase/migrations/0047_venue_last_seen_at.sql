-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0047 : venue.last_seen_at pour soft-delete crons
-- ════════════════════════════════════════════════════════════════════════
-- Issue #399 : les crons scrapers (refresh-diving, refresh-hyrox,
-- refresh-paragliding) ne désactivent jamais les venues qui ont disparu de la
-- source OSM/Overpass. Un lieu fermé reste is_published=true indéfiniment.
--
-- Stratégie (avec garde-plancher) :
--   1. Chaque cron pose last_seen_at=now() sur toutes les venues qu'il upserte.
--   2. Seulement si le run a ramené ≥ plancher (90 % du dernier count connu) →
--      les venues de cette source avec last_seen_at < run_start passent à
--      is_published=false (soft-unpublish, réversible, jamais de DELETE).
--   3. Sinon (fetch partiel suspect, ex. 429 Overpass) → on ne touche à rien.
--
-- La colonne last_seen_at remplace la logique "on ne sait pas ce qu'on n'a pas
-- vu" par une traçabilité positive : une venue vue dans le run courant a une
-- date récente, une venue fantôme a une date ancienne.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE venue
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN venue.last_seen_at IS
  'Dernière fois que ce venue a été vu dans un run de cron scraper (refresh-*).'
  ' NULL = jamais vu par un scraper (import manuel V1, ETL, venue ajouté main)'
  ' non concerné par la logique de soft-delete cron.';

-- Index partiel pour la requête de soft-unpublish (WHERE source=X AND
-- last_seen_at < run_start AND is_published=true AND deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_venue_last_seen_source
  ON venue (source, last_seen_at)
  WHERE is_published = TRUE AND deleted_at IS NULL AND last_seen_at IS NOT NULL;
