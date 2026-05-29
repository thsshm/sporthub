/**
 * Sentry client-side init (navigateur).
 *
 * Chargé automatiquement par @sentry/nextjs sur les Client Components.
 * Cf. https://docs.sentry.io/platforms/javascript/guides/nextjs/
 *
 * Le DSN est lu depuis NEXT_PUBLIC_SENTRY_DSN (exposé au client par Next.js).
 * Si non défini (dev local sans compte Sentry), le SDK ne s'initialise pas
 * et les appels à captureException deviennent silencieux côté navigateur.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample 10% des transactions pour le tracing perf — raisonnable pour
    // un MVP, à ajuster une fois qu'on aura du trafic réel.
    tracesSampleRate: 0.1,
    // En dev, on log dans la console plutôt que d'envoyer à Sentry.
    debug: false,
    environment: process.env.NODE_ENV,
  });
}
