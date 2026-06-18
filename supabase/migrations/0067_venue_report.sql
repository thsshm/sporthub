-- ════════════════════════════════════════════════════════════════════════
-- Migration 0067 : table venue_report (#613) — signalements d'erreurs publics
-- ════════════════════════════════════════════════════════════════════════
-- Permet à n'importe qui (SANS compte) de signaler un problème sur une fiche :
-- lieu fermé, mauvais sport, info erronée, doublon, autre. Insert autorisé en
-- anon (RLS WITH CHECK true) ; AUCUNE policy SELECT → table interne, invisible
-- aux clients publics (seuls service_role/admin la lisent, en bypass RLS).
-- Distinct de claim_request (revendication de propriété, lui exige l'auth).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_report (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id    UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  -- Type de problème, borné (la route /api/report valide la même liste).
  issue_type  TEXT NOT NULL CHECK (
    issue_type IN ('closed', 'wrong_sport', 'wrong_info', 'duplicate', 'other')
  ),
  note             TEXT,                                       -- détail libre optionnel
  reporter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'open',                   -- open | reviewed | resolved | rejected
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venue_report_venue ON venue_report(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_report_status ON venue_report(status);

ALTER TABLE venue_report ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut SIGNALER (insert), sans compte (#613). Les contraintes de
-- table (issue_type CHECK + venue_id FK) bornent la validité côté DB ; la route
-- /api/report valide en plus (type + longueur de note). PAS de policy SELECT →
-- les signalements ne sont jamais lisibles publiquement.
CREATE POLICY venue_report_insert_public ON venue_report
  FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT INSERT ON venue_report TO anon, authenticated;
