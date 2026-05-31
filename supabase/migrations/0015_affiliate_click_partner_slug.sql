-- Relie affiliate_click au référentiel partner (#209, suite #111).
--
-- Aujourd'hui `affiliate_click.partner` est du texte libre (copié depuis
-- `booking_link.partner`), tandis que le référentiel `partner` (0012) utilise un
-- `slug`. Les deux ne sont pas reliés → risque de divergence ("Anybuddy" vs
-- "anybuddy"). On ajoute une colonne `partner_slug` normalisée, alignée sur
-- `partner.slug`, pour permettre la jointure (commission / affiliate_id par clic).
--
-- Pas de FK DURE : l'insert de clic dans /api/go est best-effort (erreurs
-- avalées pour ne jamais casser la redirection). Une FK rejetterait un clic
-- d'un partenaire non encore référencé → perte de donnée d'attribution. On garde
-- donc une référence LOGIQUE (jointure `partner_slug = partner.slug`) sans
-- contrainte, et on documente l'invariant.

ALTER TABLE affiliate_click
  ADD COLUMN IF NOT EXISTS partner_slug TEXT;

COMMENT ON COLUMN affiliate_click.partner_slug IS
  'Slug normalisé du partenaire (référence logique partner.slug, #209). Dérivé de affiliate_click.partner par la route /api/go (normalizePartnerSlug). Pas de FK dure : l''insert best-effort ne doit jamais être rejeté.';

-- Backfill des clics existants : même normalisation que lib/affiliate.ts
-- (minuscules, non-alphanum → "-", tirets de bord retirés). Les accents ne sont
-- pas gérés ici (extension unaccent non garantie) — sans impact sur les 8
-- partenaires seedés (aucun accent).
UPDATE affiliate_click
SET partner_slug = NULLIF(
  trim(BOTH '-' FROM regexp_replace(lower(trim(partner)), '[^a-z0-9]+', '-', 'g')),
  ''
)
WHERE partner_slug IS NULL
  AND partner IS NOT NULL
  AND trim(partner) <> '';

-- Index pour les agrégations dashboard (clics groupés par partenaire).
CREATE INDEX IF NOT EXISTS idx_affiliate_click_partner_slug
  ON affiliate_click (partner_slug);
