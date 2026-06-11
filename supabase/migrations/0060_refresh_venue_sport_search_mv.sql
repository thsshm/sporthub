-- ════════════════════════════════════════════════════════════════════════
-- Migration 0060 : refresh de mv_venue_sport_search (+ grid_agg) via pg_cron (#556)
-- ════════════════════════════════════════════════════════════════════════
-- BUG : mv_venue_sport_search (créée en 0054, rebuild 0056) n'avait AUCUN
-- mécanisme de refresh — contrairement aux autres MV (refresh_top_cities_mv,
-- refresh_disciplines_ranking_mv, refresh_top_clubs_by_sport_mv,
-- refresh_venue_aggregates). Elle était donc FIGÉE depuis sa création.
--
-- Conséquence : les pages /sports/[sport] (qui comptent/listent via cette MV,
-- cf. lib/venue/visible-count.ts) dérivent à mesure que les venues sont
-- ajoutées/reclassées. Exemple constaté en prod le 2026-06-11 : /sports/gym,
-- /sports/pilates, /sports/dance affichent « No venue » alors que la table
-- contient 1000+ venues primary_sport_slug='gym' (la CARTE les voit, car elle
-- lit la table en direct via venues_in_bbox — d'où la divergence carte↔page).
--
-- FIX : fonction de refresh (REFRESH NON-concurrent — CONCURRENTLY est interdit
-- dans une fonction/transaction, cf. leçon 0041) + cron quotidien. grid_agg
-- dérive de search → refresh search D'ABORD. statement_timeout relevé car la MV
-- est volumineuse (~200k lignes : venues × sports). Le refresh par REST est
-- impossible (cap ~8s du gateway, cf. 0045) → pg_cron côté serveur.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_venue_sport_search_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
AS $$
BEGIN
  -- Ordre imposé : mv_venue_sport_grid_agg est dérivée de mv_venue_sport_search.
  REFRESH MATERIALIZED VIEW mv_venue_sport_search;
  REFRESH MATERIALIZED VIEW mv_venue_sport_grid_agg;
END;
$$;

REVOKE ALL ON FUNCTION refresh_venue_sport_search_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_venue_sport_search_mv() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent : déprogramme l'éventuel job existant avant de (re)programmer.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-venue-sport-search');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job inexistant → ignore
END $$;

-- Quotidien 04:30 UTC — après les imports ETL nocturnes (data-refresh 02:00→~04:00),
-- pour que les venues fraîchement importées apparaissent sur les pages SEO.
SELECT cron.schedule(
  'refresh-venue-sport-search',
  '30 4 * * *',
  $cmd$ SELECT public.refresh_venue_sport_search_mv() $cmd$
);

-- Refresh immédiat : corrige l'état figé courant (gym/pilates/dance → "No venue").
-- S'exécute pendant le db-push (connexion directe Postgres, hors gateway 8s).
SELECT public.refresh_venue_sport_search_mv();
