-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0009 : index spatial partiel sur venues publiées
-- ════════════════════════════════════════════════════════════════════════
-- Issue #115 (perf carte — Sprint 1 quick wins).
--
-- Contexte : ~99 % des requêtes `/api/venues` (et donc des RPCs
-- `venues_in_bbox` / `venues_in_bbox_minimal`) filtrent par
-- `is_published = true AND deleted_at IS NULL`. Le full GIST `idx_venue_geom`
-- (migration 0003) couvre toutes les venues, y compris brouillons et
-- soft-deletées. Un index partiel exactement matché sur ces deux prédicats
-- est plus petit, tient mieux en cache, et le planner le préfère
-- systématiquement quand la requête a ces deux clauses.
--
-- ⚠️ APPLIQUER MANUELLEMENT VIA LE SQL EDITOR SUPABASE — PAS `supabase db push`
-- ────────────────────────────────────────────────────────────────────────
-- `CREATE INDEX CONCURRENTLY` est obligatoire pour ne pas locker la table en
-- prod (348k rows), mais Postgres interdit `CONCURRENTLY` à l'intérieur d'une
-- transaction. La CLI Supabase enveloppe chaque migration dans une
-- transaction implicite ; il faut donc copier-coller ce fichier dans le SQL
-- Editor du Dashboard et l'exécuter hors transaction.
--
-- Procédure :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Coller le contenu de ce fichier
--   3. Run
--   4. Vérifier `\d venue` (ou la requête `pg_indexes` du runbook) :
--      `idx_venue_geom_published` doit apparaître.
--   5. Commit + push de ce fichier pour traçabilité (pas re-rejoué par CLI
--      car déjà créé en prod ; sera rejoué tel quel sur les envs neufs).
--
-- Voir `docs/perf-audit-2026-05-29.md` pour le runbook complet.
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venue_geom_published
  ON venue USING GIST(geom)
  WHERE is_published = true AND deleted_at IS NULL;

COMMENT ON INDEX idx_venue_geom_published IS
  'Partial GIST index for the common case: published, non-deleted venues. '
  'Used by /api/venues and the venues_in_bbox / venues_in_bbox_minimal RPCs. '
  'Created out-of-transaction via Supabase SQL Editor (issue #115).';
