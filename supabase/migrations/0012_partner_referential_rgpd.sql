-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0012 : référentiel partner + durcissement RGPD
--                                 de affiliate_click
-- ════════════════════════════════════════════════════════════════════════
-- Issue #111 — convergence des deux pistes d'implémentation (cf. PR #203 qui
-- a posé affiliate_click en 0011, et PR #202 qui proposait partner/partner_click).
--
-- On NE recrée PAS une table de clics : affiliate_click (migration 0011) est
-- déjà en prod et alimentée par /api/go/[id]. Cette migration :
--   1. ajoute un RÉFÉRENTIEL `partner` (slug, affiliate_id, commission_rate)
--      — le foyer des deals d'affiliation (repris de #202) ;
--   2. seed les 8 plateformes partenaires initiales ;
--   3. durcit affiliate_click avec des colonnes RGPD-safe (ip_hash, user_agent,
--      referer) pour une attribution plus fine sans stocker d'IP en clair.
--
-- RGPD : aucune IP en clair n'est stockée — uniquement ip_hash = SHA-256(ip+salt)
-- calculé côté route. Pas de PII → pas de bandeau cookie requis.
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- 1. Table partner — référentiel des plateformes affiliées
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE partner (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
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
  'Plateformes partenaires affiliées (référentiel). affiliate_id NULL tant qu''aucun deal signé ; les clics sont tracés dans affiliate_click pour justifier la négociation.';

CREATE TRIGGER trg_partner_updated_at BEFORE UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS : lecture publique des partenaires actifs (données non sensibles,
-- ouvre la voie à une future page « nos partenaires »). Écriture réservée
-- au service_role (bypass RLS) → aucune policy INSERT/UPDATE/DELETE.
ALTER TABLE partner ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture publique des partenaires actifs"
  ON partner FOR SELECT
  USING (is_active = TRUE);

-- Seed des 8 partenaires initiaux (affiliate_id NULL : aucun deal signé).
INSERT INTO partner (slug, name) VALUES
  ('anybuddy',         'Anybuddy'),
  ('classpass',        'ClassPass'),
  ('mindbody',         'Mindbody'),
  ('playtomic',        'Playtomic'),
  ('surf-forecast',    'Surf-Forecast'),
  ('kitesurf-schools', 'Kitesurf Schools'),
  ('superprof',        'Superprof'),
  ('bookyogaretreats', 'BookYogaRetreats');

-- ────────────────────────────────────────────────────────────────────────
-- 2. Durcissement RGPD de affiliate_click (migration 0011)
-- ────────────────────────────────────────────────────────────────────────
-- Colonnes optionnelles : la route les remplit best-effort. Jamais d'IP en
-- clair — ip_hash = SHA-256(ip + IP_HASH_SALT) calculé dans la route.
ALTER TABLE affiliate_click
  ADD COLUMN IF NOT EXISTS ip_hash    TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS referer    TEXT;

COMMENT ON COLUMN affiliate_click.ip_hash IS
  'SHA-256(ip + salt) — jamais l''IP en clair (RGPD). NULL si IP absente.';
