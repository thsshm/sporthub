-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0048 : schéma enrichissement padel (#345, PR A)
-- ════════════════════════════════════════════════════════════════════════
-- Prépare l'enrichissement des clubs padel FR depuis Playtomic (API publique
-- directe, cf. spike #345 — pas de Bright Data). Migration de SCHÉMA seule :
-- aucune donnée écrite ici (le scraper Python le fera, PR B/C).
--
-- Décisions (@thsshm) :
--   - `booking_url` = nouvelle colonne sur venue (lien de résa Playtomic).
--   - `courts_count` (RES/cluster) CONSERVÉ ; on AJOUTE `courts_indoor` /
--     `courts_outdoor` (comptés depuis Playtomic `resources[].resource_type`).
--     Ces deux colonnes seront filtrables côté carte → typage justifié (vs
--     enrichments JSONB, cf. ROADMAP-SCALE).
--   - `external_ref` : table de traçabilité des correspondances source externe
--     ↔ venue (clé (source, external_id) ; payload brut + last_seen_at pour la
--     fraîcheur). Upsert idempotent côté scraper.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Colonnes d'enrichissement sur venue (nullable → additif, rétro-compatible).
ALTER TABLE venue
  ADD COLUMN IF NOT EXISTS booking_url    TEXT,
  ADD COLUMN IF NOT EXISTS courts_indoor  INTEGER,
  ADD COLUMN IF NOT EXISTS courts_outdoor INTEGER;

-- 2) Table de référence externe (Playtomic, et futures sources d'enrichissement).
CREATE TABLE IF NOT EXISTS external_ref (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id     UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,                 -- "playtomic"
  external_id  TEXT NOT NULL,                 -- tenant_id Playtomic
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Une réf externe (source, external_id) ne pointe qu'un seul venue → clé
  -- d'upsert idempotente côté scraper (#345 PR C).
  UNIQUE (source, external_id)
);

-- Accès par venue (jointure fiche) ; index partiel par source pour les scans.
CREATE INDEX IF NOT EXISTS idx_external_ref_venue ON external_ref (venue_id);
CREATE INDEX IF NOT EXISTS idx_external_ref_source ON external_ref (source);

CREATE TRIGGER trg_external_ref_updated_at
  BEFORE UPDATE ON external_ref
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Données internes d'enrichissement (pas d'usage public direct) : RLS activée,
-- pas de policy publique → seul le service_role (scraper) écrit/lit. La donnée
-- exposée au public l'est via les colonnes de `venue` (déjà en lecture publique).
ALTER TABLE external_ref ENABLE ROW LEVEL SECURITY;
