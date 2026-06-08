-- Fusion de la famille « escalade » dans « hike » (Outdoor & endurance) — #470.
--
-- L'ex-famille escalade (#312, 343 venues climbing_indoor) est rattachée à la
-- famille hike côté app (lib/families.ts). On aligne la donnée : les venues
-- encore taguées family_slug='escalade' passent sous 'hike'. Le sport
-- (primary_sport_slug / venue_sport = climbing_indoor) reste inchangé.
--
-- Idempotent : ré-exécutable sans effet une fois la donnée migrée.
-- À APPLIQUER (db-push) AVANT de merger le changement de config, sinon les
-- 343 venues 'escalade' perdent temporairement leur famille (fallback gris).

UPDATE venue
SET family_slug = 'hike',
    updated_at = NOW()
WHERE family_slug = 'escalade';
