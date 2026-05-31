-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0011 : table affiliate_click
-- ════════════════════════════════════════════════════════════════════════
-- Journalise chaque clic sur un lien de réservation partenaire (issue #111,
-- phase 3).
--
-- Contexte :
--   La route /api/go/[id] (mergée en part 1/2) résout un booking_link,
--   décore l'URL avec les UTM SportHub et redirige en 302. Cette migration
--   ajoute la persistance des clics, qui alimente le dashboard partenaire
--   /admin/affiliate (clics par partenaire / par venue / dans le temps).
--
-- Modèle :
--   - Une ligne par clic. Volume potentiellement élevé → table append-only,
--     pas d'index superflu. created_at indexé pour les agrégats temporels.
--   - booking_link_id en FK ON DELETE CASCADE : si un lien partenaire est
--     supprimé, ses clics historiques partent avec (on ne conserve pas de
--     stats orphelines). Si on veut garder l'historique au-delà de la vie
--     du lien, basculer en ON DELETE SET NULL — choix produit, à trancher
--     en part dashboard avancé.
--   - partner + venue_id dénormalisés (copie au moment du clic) pour que les
--     agrégats restent corrects même si le booking_link est modifié/supprimé.
--   - source : origine UI du clic (venue_page, map_popup…), nullable.
--   - Pas d'updated_at : un clic est un événement immuable.
--
-- RLS :
--   Activée SANS aucune policy → deny-all pour les rôles anon/authenticated.
--   Les écritures (route /api/go) et les lectures (dashboard admin) passent
--   exclusivement par le service_role (getSupabaseAdminClient), qui bypass
--   RLS. Aucune donnée analytique n'est ainsi exposée à un client public.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE affiliate_click (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_link_id  UUID REFERENCES booking_link(id) ON DELETE CASCADE,
  -- Champs dénormalisés (copiés au moment du clic) : robustes à la
  -- modification/suppression ultérieure du booking_link.
  partner          TEXT NOT NULL,
  venue_id         UUID,
  source           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agrégats du dashboard : "clics récents", "clics par jour".
CREATE INDEX idx_affiliate_click_created ON affiliate_click(created_at DESC);
-- Agrégats "clics par partenaire" et "par venue".
CREATE INDEX idx_affiliate_click_partner ON affiliate_click(partner);
CREATE INDEX idx_affiliate_click_venue ON affiliate_click(venue_id);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security — deny-all (accès via service_role uniquement)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE affiliate_click ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune policy : anon/authenticated ne peuvent ni lire ni
-- écrire. service_role bypass RLS pour /api/go (insert) et /admin (select).
