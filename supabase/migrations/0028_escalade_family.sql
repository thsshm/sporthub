-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0028 : famille 'escalade' (#312, palier 2)
-- ════════════════════════════════════════════════════════════════════════
-- Contexte : palier 1 (0027) a aligné venue.family_slug sur la famille du
-- primary_sport_slug pour les venues AYANT un sport, laissant ~887 venues
-- 'autre' + primary_sport_slug IS NULL au palier 2 (décision #312 option 2 :
-- enquêter avant de classer).
--
-- L'enquête (v1_spot_id → SQLite V1 `spots.sport_type`) a montré que le plus
-- gros groupe mappable est l'escalade/bloc (climbing + climbing_adventure ≈
-- 627 spots V1 sous 'autre'), qui n'avait pas de famille canonique dédiée et
-- tombait dans 'plus'. On crée donc la famille 'escalade' et on y rattache le
-- sport de référence `climbing_indoor` (jusqu'ici en 'plus').
--
-- Cette migration ne touche QUE la table de référence `sport` (source de
-- vérité DB, miroir de lib/sports.ts). family_slug est un TEXT libre (aucune
-- contrainte CHECK/enum ni table `family` — cf. 0001), donc 'escalade' est
-- accepté sans DDL.
--
-- Le reclassement des ~887 venues (family_slug + primary_sport_slug dérivés de
-- V1 sport_type) se fait HORS migration, via scripts/backfill_family_null_sport.py
-- : le lookup du SQLite V1 par v1_spot_id est impossible en SQL pur depuis
-- Postgres, et un UPDATE de masse se ferait couper par le statement-timeout
-- (cf. #312, 57014). Le script suit le pattern keyset + PATCH par lots de
-- scripts/backfill_courts_count_rest.py.
--
-- Idempotent (re-run = no-op). Transactionnel.
--
-- ── Audit (avant/après) ─────────────────────────────────────────────────────
--   SELECT family_slug, count(*) FROM sport WHERE slug = 'climbing_indoor'
--   GROUP BY 1;  -- attendu APRÈS : escalade | 1
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE sport
SET family_slug = 'escalade'
WHERE slug = 'climbing_indoor'
  AND family_slug <> 'escalade';

COMMIT;
