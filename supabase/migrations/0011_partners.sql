-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0011 : tracking affilié (partner + partner_click)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #111 (phase 3 — monétisation initiale).
--
-- Contexte :
--   Les plateformes partenaires (Anybuddy, ClassPass, Mindbody, Playtomic,
--   Surf-Forecast, Kitesurf Schools, Superprof, BookYogaRetreats) sont la
--   piste de revenu #1 du DASHBOARD V1, mais en V1 les liens partaient en
--   direct, sans UTM ni tracking → impossible de prouver à un partenaire
--   qu'on génère du clic, donc pas de deal d'affiliation.
--
--   Cette migration pose l'infrastructure de tracking :
--     - `partner`        : référentiel des plateformes (+ template d'URL).
--     - `partner_click`  : un événement par clic sortant (via /r/<partner>/<slug>).
--
--   Le route handler `app/r/[partner]/[venue_slug]/route.ts` lit `partner`,
--   construit l'URL finale (template + UTM + affiliate_id), enregistre un
--   `partner_click`, puis 302 vers le partenaire.
--
-- RGPD :
--   `partner_click` ne stocke JAMAIS l'IP en clair — uniquement `ip_hash` =
--   SHA-256(ip + salt). Pas de PII → pas de cookie banner requis.
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- Table partner — référentiel des plateformes affiliées
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE partner (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- URL de base avec placeholders {slug} (venue) et {affiliate_id}.
  -- Ex : 'https://anybuddy.com/clubs/{slug}?aff={affiliate_id}'.
  base_url_template TEXT NOT NULL,
  -- NULL tant qu'aucun deal d'affiliation n'est signé — on tracke quand même
  -- les clics pour justifier la demande de deal (« j'envoie 500 clics/mois »).
  affiliate_id      TEXT,
  -- Taux de commission négocié (0.0500 = 5 %), informatif.
  commission_rate   NUMERIC(5, 4),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE partner IS
  'Plateformes partenaires affiliées. base_url_template porte les placeholders {slug} et {affiliate_id}, substitués au runtime par le redirect route /r/.';

CREATE TRIGGER trg_partner_updated_at BEFORE UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Table partner_click — un événement par clic sortant
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE partner_click (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_slug TEXT NOT NULL REFERENCES partner(slug) ON DELETE CASCADE,
  -- venue d'origine du clic. NULL si le slug d'URL ne résout aucune venue
  -- (on tracke le clic quand même plutôt que de le perdre).
  venue_id     UUID REFERENCES venue(id) ON DELETE SET NULL,
  -- slug brut de l'URL, conservé même si venue_id n'a pas résolu.
  venue_slug   TEXT,
  -- user authentifié si session présente, sinon NULL (clic anonyme).
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- SHA-256(ip + salt) — jamais l'IP en clair (RGPD).
  ip_hash      TEXT,
  user_agent   TEXT,
  referer      TEXT,
  clicked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE partner_click IS
  'Événements de clic sortant vers un partenaire. ip_hash = SHA-256(ip+salt) (RGPD : pas d''IP en clair). Aggregé par le dashboard /admin/partner-clicks.';

-- Lookup principal du dashboard : "clics par partenaire sur les N derniers jours".
CREATE INDEX idx_partner_click_partner ON partner_click(partner_slug, clicked_at DESC);
-- Lookup secondaire : "top venues cliquants".
CREATE INDEX idx_partner_click_venue ON partner_click(venue_id);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE partner ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_click ENABLE ROW LEVEL SECURITY;

-- partner : lecture publique des plateformes actives (données non sensibles :
-- name + template + affiliate_id sont de toute façon visibles dans l'URL de
-- redirection). Le redirect route lit via service_role, mais cette policy
-- ouvre la voie à une future page publique « nos partenaires ».
CREATE POLICY "Lecture publique des partenaires actifs"
  ON partner FOR SELECT
  USING (is_active = TRUE);

-- partner_click : INSERT autorisé à tous (le redirect route, anon ou non).
-- Aucune policy SELECT → seul service_role (bypass RLS) peut lire les clics,
-- ce qui réserve l'analytics au dashboard admin.
CREATE POLICY "Insertion d'un clic par n'importe qui"
  ON partner_click FOR INSERT
  WITH CHECK (TRUE);

-- ────────────────────────────────────────────────────────────────────────
-- Seed des 8 partenaires initiaux
-- ────────────────────────────────────────────────────────────────────────
-- affiliate_id = NULL (aucun deal signé pour l'instant). Les templates sont
-- provisoires : à affiner par partenaire quand un deal est conclu. {slug}
-- correspond au slug de la venue SportHub (best-effort en search/deep-link).
INSERT INTO partner (slug, name, base_url_template) VALUES
  ('anybuddy',         'Anybuddy',          'https://www.anybuddyapp.com/recherche?q={slug}'),
  ('classpass',        'ClassPass',         'https://classpass.com/search/{slug}'),
  ('mindbody',         'Mindbody',          'https://www.mindbodyonline.com/explore/search?q={slug}'),
  ('playtomic',        'Playtomic',         'https://playtomic.io/search?q={slug}'),
  ('surf-forecast',    'Surf-Forecast',     'https://www.surf-forecast.com/breaks/{slug}'),
  ('kitesurf-schools', 'Kitesurf Schools',  'https://www.iko-kiteboarding.org/?s={slug}'),
  ('superprof',        'Superprof',         'https://www.superprof.fr/s/{slug}.html'),
  ('bookyogaretreats', 'BookYogaRetreats',  'https://www.bookyogaretreats.com/s/{slug}');
