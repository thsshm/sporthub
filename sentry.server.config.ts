/**
 * Sentry server-side init (Node runtime).
 *
 * Chargé automatiquement via instrumentation.ts (App Router) au démarrage
 * du process Node — couvre les Server Components, API routes, middleware
 * exécuté côté Node.
 *
 * Le DSN est lu depuis SENTRY_DSN (server-only). On garde la même valeur
 * que NEXT_PUBLIC_SENTRY_DSN — la séparation existe surtout pour permettre
 * un DSN distinct si on voulait isoler les events server/client un jour.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
    environment: process.env.NODE_ENV,
  });
}
