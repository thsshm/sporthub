/**
 * Façade monitoring pour SportHub V2.
 *
 * État actuel : no-op (console.* en dev, rien en prod).
 *
 * Pour activer Sentry + PostHog réels :
 *   1. Créer un compte sur sentry.io → New Project → Next.js → copy DSN
 *   2. Créer un compte sur eu.posthog.com → New Project → copy public API key
 *   3. Ajouter dans .env.local + Vercel project env vars :
 *      SENTRY_DSN=https://...
 *      NEXT_PUBLIC_SENTRY_DSN=https://...           (même valeur, pour le client)
 *      NEXT_PUBLIC_POSTHOG_KEY=phc_...
 *      NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com
 *   4. pnpm add @sentry/nextjs posthog-js
 *   5. Remplacer les no-op ci-dessous par les vrais wiring SDK :
 *      - Sentry : sentry.client.config.ts + sentry.server.config.ts +
 *        instrumentation.ts (cf. https://docs.sentry.io/platforms/javascript/guides/nextjs/)
 *      - PostHog : créer components/PostHogProvider.tsx (Client) qui init
 *        posthog-js avec NEXT_PUBLIC_POSTHOG_KEY, wrap app/layout.tsx
 *   6. Tester via /api/monitoring/sentry-test (route déjà créée par #7)
 */

const isDev = process.env.NODE_ENV !== "production";
const sentryEnabled = !!process.env.SENTRY_DSN;
const posthogEnabled = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Capture une exception côté monitoring. À appeler dans les catch blocks
 * server-side ou via un error boundary client.
 */
export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (isDev) {
    console.error("[monitoring] exception:", error, context ?? "");
  }
  if (sentryEnabled) {
    // Stub : à remplacer par `import * as Sentry from '@sentry/nextjs'`
    // puis `Sentry.captureException(error, { extra: context })`
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
