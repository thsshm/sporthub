-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0010 : table user_favorite
-- ════════════════════════════════════════════════════════════════════════
-- Persiste les venues favoris par utilisateur authentifié.
--
-- Contexte (issue #91, phase 3) :
--   En V1 + actuellement en V2, les favoris vivent dans le localStorage
--   (clé `sporthub-favorites`, cf. MapClient + VenueCard). Cette migration
--   ajoute un stockage côté DB pour les users connectés. Le localStorage
--   reste utilisé comme fallback pour les visiteurs non authentifiés, et
--   est synchronisé vers la DB au login (one-shot, helper lib/favorites-sync).
--
-- Modèle :
--   - PK composite (user_id, venue_id) — idempotence native sur INSERT
--     ON CONFLICT DO NOTHING (cf. POST /api/favorites).
--   - ON DELETE CASCADE des deux côtés : si l'user est supprimé ou si la
--     venue est purgée (rare : on fait soft-delete via deleted_at), la
--     ligne disparaît proprement.
--   - Pas d'updated_at : un favori est soit présent soit absent, on ne
--     l'édite jamais en place (on DELETE + INSERT pour "ré-ajouter").
--
-- RLS :
--   Activée. SELECT/INSERT/DELETE par owner uniquement (auth.uid() = user_id).
--   Pas de policy UPDATE — la table n'a aucun champ éditable utile.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE user_favorite (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id    UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

-- Lookup principal : "tous les favoris de cet user" (page /favoris).
-- La PK couvre déjà (user_id, venue_id) en B-tree mais un index dédié sur
-- (user_id) seul rend les ORDER BY created_at DESC plus directs sans avoir
-- à scanner le segment de PK (pas critique, mais explicite).
CREATE INDEX idx_user_favorite_user ON user_favorite(user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE user_favorite ENABLE ROW LEVEL SECURITY;

-- SELECT : un user ne voit que ses propres favoris.
CREATE POLICY "Lecture des favoris par l'owner"
  ON user_favorite FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT : un user authentifié ne peut insérer qu'avec son propre user_id.
-- Idempotence côté API via ON CONFLICT (user_id, venue_id) DO NOTHING.
CREATE POLICY "Ajout de favori par l'owner"
  ON user_favorite FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- DELETE : un user ne peut supprimer que ses propres favoris.
CREATE POLICY "Suppression de favori par l'owner"
  ON user_favorite FOR DELETE
  USING (auth.uid() = user_id);
