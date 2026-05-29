/**
 * Façade monitoring pour SportHub V2.
 *
 * Sentry est wiré via @sentry/nextjs (cf. sentry.client.config.ts,
 * sentry.server.config.ts, sentry.edge.config.ts, instrumentation.ts).
 * Le SDK ne s'initialise que si un DSN est présent — donc en dev local
 * sans DSN, captureException reste un no-op (console en dev).
 *
 * PostHog reste à wirer (issue #96).
 *
 * Variables d'env attendues (.env.local + Vercel) :
 *   SENTRY_DSN=https://...                       (server-only)
 *   NEXT_PUBLIC_SENTRY_DSN=https://...           (même valeur, exposée au client)
 *   NEXT_PUBLIC_POSTHOG_KEY=phc_...              (à wirer dans #96)
 *   NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com
 *
 * Tester via /api/monitoring/sentry-test une fois le DSN configuré :
 * l'erreur doit apparaître dans le dashboard Sentry < 60s.
 */
import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV !== "production";
const sentryEnabled = !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
const posthogEnabled = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Capture une exception côté monitoring. À appeler dans les catch blocks
 * server-side ou via un error boundary client.
 *
 * En dev sans DSN : log console uniquement.
 * Avec DSN configuré : envoi à Sentry avec `context` mis dans `extra`.
 */
export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (isDev) {
    console.error("[monitoring] exception:", error, context ?? "");
  }
  if (sentryEnabled) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  }
}

/**
 * Track un événement produit (page view, click, conversion).
 * Server-side : émet un log structuré qu'on peut piper dans n'importe quoi.
 * Client-side : à remplacer par posthog.capture() une fois posthog-js wired.
 */
export function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (isDev) {
    console.log(`[monitoring] event "${name}":`, properties ?? {});
  }
  if (posthogEnabled) {
    // Stub : à remplacer par `posthog.capture(name, properties)` côté client
    // ou un POST vers /api/posthog côté server
  }
}

/**
 * État global du monitoring — utile pour /admin ou un health endpoint.
 */
export function monitoringStatus() {
  return {
    sentryEnabled,
    posthogEnabled,
    env: process.env.NODE_ENV ?? "unknown",
  };
}
