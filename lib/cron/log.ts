/**
 * Logging structuré pour les Route Handlers `app/api/cron/*`.
 *
 * Vercel agrège stdout dans Logs (Functions tab). Émettre du JSON (et non du
 * texte plain) permet :
 *   - de filtrer par `event` dans le Vercel dashboard (« events: cron.* »)
 *   - de piper plus tard vers un drain Logflare/Axiom sans reparser
 *   - de garder le format aligné avec ce qu'on enverra à Sentry en context.
 *
 * Les erreurs vont à `captureException` (Sentry) côté caller — ce module ne
 * fait QUE des logs `console.log` JSON-stringifiés.
 */

export type CronCompletedLog = {
  event: string; // "cron.refresh-hyrox.completed"
  upserted: number;
  failed: number;
  duration_ms: number;
  extra?: Record<string, unknown>;
};

export function logCronCompleted(payload: CronCompletedLog): void {
  // 1 ligne JSON par run — facile à grep dans Vercel logs.
  // On stringify explicitement pour éviter que la pipeline de prod ne nous
  // sérialise différemment (cas vu avec console.log({...}) qui peut tronquer).
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}
