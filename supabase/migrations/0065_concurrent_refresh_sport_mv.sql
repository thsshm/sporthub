-- ════════════════════════════════════════════════════════════════════════
-- Migration 0065 : refresh CONCURRENT des grosses MV sport (anti-outage)
-- ════════════════════════════════════════════════════════════════════════
-- INCIDENT 2026-06-12 : un REFRESH non-concurrent de mv_venue_sport_search
-- (~370k lignes) prend un lock ACCESS EXCLUSIVE → TOUTES les lectures de la MV
-- bloquent pendant le refresh → pages /sports/* et /[sport]/[ville] en timeout.
-- Une session de refresh orpheline a même bloqué la prod ~45 min (débloquée par
-- pg_terminate_backend).
--
-- Cause de fond : `refresh_venue_aggregates()` (0055) refait les 4 MV en
-- NON-concurrent (0041 avait retiré CONCURRENTLY car interdit DANS une fonction
-- plpgsql). Or `REFRESH … CONCURRENTLY` (lock SHARE UPDATE EXCLUSIVE, ne bloque
-- PAS les lectures) EST autorisé en commande pg_cron top-level (hors bloc
-- transaction) — confirmé. Les 2 grosses MV ont l'index unique requis
-- (idx_mv_vss_pk, idx_mv_vsga_pk).
--
-- Fix :
--   1. retirer les 2 grosses MV sport de la fonction (qui reste pour les 2
--      petites MV — country/grid, lock bref négligeable). La fonction est encore
--      appelée par l'ETL (dedup_venues.py) et le cron hebdo 0045 → ils ne
--      bloquent plus sur la grosse MV.
--   2. planifier le refresh des 2 grosses MV en CONCURRENT via pg_cron, toutes
--      les 6 h (concurrent = sans outage → on peut rafraîchir plus souvent que
--      l'hebdo, ce qui compense la perte du refresh post-import). search d'abord,
--      puis grid_agg (dérivée de search) + ANALYZE (chaque statement = un job
--      séparé : CONCURRENTLY interdit en multi-statement/transaction).
--
-- ⚠ Vérification post-apply (nécessite accès SQL) : `SELECT * FROM cron.job` doit
-- lister les 4 jobs ci-dessous, et `SELECT * FROM cron.job_run_details ORDER BY
-- start_time DESC` doit montrer leur exécution sans erreur au prochain tick.
-- Sans ça, un job qui échoue silencieusement = MV qui ne se rafraîchit plus.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Fonction allégée : seulement les 2 petites MV (lock bref, sans impact).
CREATE OR REPLACE FUNCTION refresh_venue_aggregates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '300s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_country_agg;
  REFRESH MATERIALIZED VIEW mv_venue_grid_agg;
END;
$$;

-- 2) Jobs pg_cron CONCURRENT pour les 2 grosses MV + ANALYZE (idempotent :
--    unschedule d'abord, ignore si le job n'existe pas). Décalage temporel :
--    search → analyze → grid (dérivée de search) → analyze. Toutes les 6 h.
DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'refresh-mv-vss', 'analyze-mv-vss',
    'refresh-mv-vss-grid', 'analyze-mv-vss-grid'
  ] LOOP
    BEGIN
      PERFORM cron.unschedule(j);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

SELECT cron.schedule('refresh-mv-vss', '0 */6 * * *',
  $cmd$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_venue_sport_search $cmd$);
SELECT cron.schedule('analyze-mv-vss', '8 */6 * * *',
  $cmd$ ANALYZE public.mv_venue_sport_search $cmd$);
SELECT cron.schedule('refresh-mv-vss-grid', '12 */6 * * *',
  $cmd$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_venue_sport_grid_agg $cmd$);
SELECT cron.schedule('analyze-mv-vss-grid', '20 */6 * * *',
  $cmd$ ANALYZE public.mv_venue_sport_grid_agg $cmd$);

-- 3) Vérif FAIL-LOUD (même transaction) : si les 4 jobs ne sont pas planifiés
--    avec une commande non vide, on PLANTE la migration → l'apply échoue
--    visiblement (pas de planification silencieusement ratée). Le run
--    apply-migrations sert ainsi de preuve que les jobs sont en place.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM cron.job
  WHERE jobname IN ('refresh-mv-vss', 'analyze-mv-vss',
                    'refresh-mv-vss-grid', 'analyze-mv-vss-grid')
    AND command IS NOT NULL AND length(btrim(command)) > 0
    AND active;
  IF n <> 4 THEN
    RAISE EXCEPTION
      'Planification cron incomplète : % / 4 jobs actifs attendus. Migration annulée.', n;
  END IF;
  RAISE NOTICE 'OK : 4 jobs cron de refresh concurrent planifiés.';
END $$;
