-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0043 : ETL socle — import_run + UNIQUE (source, external_id)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #227 (Phase 1.B, 227.1) : couper le cordon SQLite V1.
--
-- Deux ajouts :
--
--   1. Contrainte UNIQUE (source, external_id) sur venue.
--      L'index simple `idx_venue_source_extid` existe (0001) mais n'est pas une
--      contrainte → `ON CONFLICT (source, external_id) DO UPDATE` est impossible.
--      On remplace l'index par une contrainte UNIQUE (qui crée son propre index).
--
--   2. Table `import_run` : traçabilité de chaque run d'import ETL.
--      Chaque run insert/upsert une ligne avec son périmètre (source, scope),
--      ses métriques (rows_upserted, rows_deleted) et son statut
--      (pending → running → completed | failed). Permet de reprendre un run
--      interrompu (idempotence) et de monitorer les dérives de données.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Remplacer l'index simple par une vraie contrainte UNIQUE
--    (nécessaire pour ON CONFLICT (source, external_id) DO UPDATE).
DROP INDEX IF EXISTS idx_venue_source_extid;
ALTER TABLE venue
  ADD CONSTRAINT venue_source_extid_uq UNIQUE (source, external_id);

-- 2. Table import_run — traçabilité et idempotence des runs ETL.
CREATE TABLE IF NOT EXISTS import_run (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification du run.
  source          TEXT NOT NULL,   -- 'osm', 'overture', 'res', 'wikidata', …
  scope           TEXT NOT NULL,   -- ex. 'raquette/FR', 'tennis/europe', 'global'
  runner          TEXT,            -- 'gh-actions', 'vercel-cron', 'local', …

  -- Cycle de vie.
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  -- Métriques.
  rows_fetched    INTEGER,
  rows_upserted   INTEGER,
  rows_skipped    INTEGER,         -- no-change (même hash / même payload)
  rows_deleted    INTEGER,         -- soft-deleted (disparus de la source)
  error_message   TEXT,            -- null si completed

  -- Idempotence : hash du config/paramètres pour éviter les doubles runs.
  run_hash        TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index de lecture courants :
--   - liste des runs récents par source/scope (dashboard, monitoring)
--   - nettoyage des vieux runs (TTL par source)
CREATE INDEX IF NOT EXISTS import_run_source_scope
  ON import_run (source, scope, started_at DESC);
CREATE INDEX IF NOT EXISTS import_run_status
  ON import_run (status)
  WHERE status IN ('pending', 'running'); -- partiel : seuls les runs actifs

-- RLS : lecture publique des runs (monitoring ouvert) ; écriture service_role.
ALTER TABLE import_run ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lecture publique import_run" ON import_run;
CREATE POLICY "Lecture publique import_run"
  ON import_run FOR SELECT USING (true);
