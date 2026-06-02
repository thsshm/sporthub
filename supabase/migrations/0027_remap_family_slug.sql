-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0027 : remap venue.family_slug hors-référentiel (#312)
-- ════════════════════════════════════════════════════════════════════════
-- Problème : ~2 300 venues publiées portent un family_slug hors des 13 familles
-- canoniques (lib/families.ts) — surtout 'autre' (1415) + NULL. Conséquence UI :
-- pas de chip dans FamilySwitcher (invisible au filtrage famille), fallback
-- couleur/emoji générique. Or chaque sport déclare déjà sa famille canonique
-- (table `sport.family_slug` = lib/sports.ts). Il ne s'agit donc pas d'inventer
-- un mapping mais d'aligner venue.family_slug sur la famille de son propre
-- primary_sport_slug.
--
-- PALIER 1 (ce ticket) : ne traite QUE les venues avec un primary_sport_slug
-- (famille dérivable du sport). Les ~887 venues à primary_sport_slug IS NULL
-- sont LAISSÉES TELLES QUELLES — décision #312 (option 2) : enquêter leurs
-- raw_tags/noms avant de les classer plutôt que les jeter par défaut dans
-- 'plus'. → palier 2 dédié.
--
-- Idempotent (re-run = no-op une fois canonique). Soft-deleted exclus.
-- Transactionnel (pas d'index CONCURRENTLY).
--
-- ── Audit (à lancer avant/après) ───────────────────────────────────────────
--   SELECT family_slug, primary_sport_slug IS NULL AS sport_null, count(*)
--   FROM venue
--   WHERE deleted_at IS NULL
--     AND (family_slug IS NULL OR family_slug NOT IN (
--       'raquette','ballon','fitness','combat','yoga','baignade','boules',
--       'nautique','glisse','snow','hike','retraites','plus'))
--   GROUP BY 1, 2 ORDER BY 3 DESC;
--   -- Attendu APRÈS : il ne reste QUE des lignes sport_null = true (≈887,
--   -- résiduel documenté pour le palier 2). Zéro ligne avec un sport.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Venues AVEC un primary_sport_slug : on prend la famille canonique du sport
--    (jointure sur la table `sport`, source de vérité = lib/sports.ts).
UPDATE venue v
SET family_slug = s.family_slug,
    updated_at  = NOW()
FROM sport s
WHERE v.primary_sport_slug = s.slug
  AND v.primary_sport_slug IS NOT NULL
  AND v.deleted_at IS NULL
  AND (
    v.family_slug IS NULL
    OR v.family_slug NOT IN (
      'raquette','ballon','fitness','combat','yoga','baignade','boules',
      'nautique','glisse','snow','hike','retraites','plus'
    )
  )
  -- garde-fou : la famille du sport est elle-même canonique (toujours vrai par
  -- construction lib/sports.test.ts, mais on ne réintroduit pas du hors-réf).
  AND s.family_slug IN (
    'raquette','ballon','fitness','combat','yoga','baignade','boules',
    'nautique','glisse','snow','hike','retraites','plus'
  );

-- Les venues à primary_sport_slug IS NULL (≈887) ne sont PAS touchées ici
-- (palier 2 — enquête raw_tags, cf. décision #312 option 2).

COMMIT;
