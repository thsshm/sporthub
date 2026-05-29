/**
 * Sentry init pour le runtime Edge (middleware + API routes en `runtime: "edge"`).
 *
 * Le runtime Edge tourne dans un Worker isolé qui ne partage rien avec Node ;
 * il faut donc un init distinct du serveur. Sentry expose le même module
 * `@sentry/nextjs` qui détecte automatiquement le runtime.
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
