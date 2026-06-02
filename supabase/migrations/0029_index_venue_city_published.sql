-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0029 : index partiel venue(city_id) publiées
-- ════════════════════════════════════════════════════════════════════════
-- Bug : /villes (et la section "villes" de la home) vide en prod. Le RPC
-- `top_cities_by_venue_count` (migration 0017) time out :
--   POST /rest/v1/rpc/top_cities_by_venue_count → 500
--   {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- Le RPC fait `GROUP BY city` sur toutes les venues publiées (267k+) avec le
-- prédicat `is_published = TRUE AND deleted_at IS NULL`. Aucun index n'est
-- aligné dessus avec `city_id` en colonne de tête :
--   - idx_venue_city          → partiel sur deleted_at seulement (pas published)
--   - idx_venue_sport_city    → colonne de tête primary_sport_slug (inutile ici)
-- Le planner tombe sur un scan lourd + agrégat qui dépasse le statement_timeout.
--
-- Cet index partiel matche exactement le prédicat et place city_id en tête :
-- le COUNT/GROUP BY devient un index-only scan (quelques dizaines de ms).
-- La home affichera alors les vrais top (au lieu de son fallback FR hardcodé),
-- et /villes se peuplera.
--
-- ⚠️ APPLIQUER MANUELLEMENT VIA LE SQL EDITOR SUPABASE — PAS `supabase db push`
-- ────────────────────────────────────────────────────────────────────────
-- `CREATE INDEX CONCURRENTLY` est obligatoire pour ne pas locker la table en
-- prod, mais Postgres l'interdit dans une transaction. La CLI Supabase enveloppe
-- chaque migration dans une transaction → copier-coller ce fichier dans le SQL
-- Editor du Dashboard et l'exécuter hors transaction (cf. migration 0009).
--
-- Procédure :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Coller le contenu de ce fichier
--   3. Run
--   4. Vérifier : `idx_venue_city_published` apparaît dans pg_indexes / \d venue
--   5. Smoke-test : le RPC top_cities_by_venue_count(48) répond < 1s
--   6. Commit + push de ce fichier pour traçabilité (déjà créé en prod, non
--      rejoué par la CLI ; rejoué tel quel sur les envs neufs).
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venue_city_published
  ON venue(city_id)
  WHERE is_published = TRUE AND deleted_at IS NULL;

COMMENT ON INDEX idx_venue_city_published IS
  'Partial index for the published-venue-per-city aggregate '
  '(RPC top_cities_by_venue_count, migration 0017). city_id leading + exact '
  'predicate match → index-only GROUP BY/COUNT. Created out-of-transaction via '
  'Supabase SQL Editor.';
