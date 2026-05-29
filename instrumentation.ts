/**
 * Next.js instrumentation hook — appelé une fois au boot du serveur.
 *
 * Branche Sentry sur les runtimes Node et Edge. Le client est initialisé
 * automatiquement par @sentry/nextjs via sentry.client.config.ts (côté
 * navigateur, pas chargé ici).
 *
 * Cf. https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture les erreurs survenues dans les Server Components / Server Actions
// (Next 15+). En 14, c'est inoffensif si non appelé.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
