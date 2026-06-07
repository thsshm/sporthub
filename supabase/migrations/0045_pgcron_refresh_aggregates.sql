-- ════════════════════════════════════════════════════════════════════════
-- Migration 0043 : refresh des MV d'agrégats via pg_cron (#387)
-- ════════════════════════════════════════════════════════════════════════
-- Le refresh (~9s) dépasse le cap ~8s du gateway API Supabase → impossible via
-- le cron Vercel (REST). On planifie le refresh DANS la base avec pg_cron :
-- il s'exécute côté serveur, hors gateway, et bénéficie du statement_timeout
-- 120s de la fonction (migration 0042). Hebdo lundi 09:00 UTC.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent : déprogramme l'éventuel job existant avant de (re)programmer.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-venue-aggregates');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job inexistant → ignore
END $$;

SELECT cron.schedule(
  'refresh-venue-aggregates',
  '0 9 * * 1',
  $cmd$ SELECT public.refresh_venue_aggregates() $cmd$
);
