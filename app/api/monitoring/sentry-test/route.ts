import { NextResponse } from "next/server";
import { captureException } from "@/lib/monitoring";

/**
 * Route test pour valider que le monitoring capture bien les exceptions.
 * - Si SENTRY_DSN n'est pas configuré : retourne juste un log + 500
 * - Si configuré : l'erreur doit apparaître dans le dashboard Sentry < 60s
 *
 * Usage : `curl https://sporthub-git-main-gautier-ths.vercel.app/api/monitoring/sentry-test`
 */
export async function GET() {
  const err = new Error("Sentry test exception — déclenchée volontairement");

  try {
    throw err;
  } catch (caught) {
    captureException(caught, { source: "/api/monitoring/sentry-test", intentional: true });
  }

  return NextResponse.json(
    {
      ok: false,
      thrown: err.message,
      monitoring: {
        sentry_enabled: !!process.env.SENTRY_DSN,
        posthog_enabled: !!process.env.NEXT_PUBLIC_POSTHOG_KEY,
      },
      note:
        "Si sentry_enabled = false, ajouter SENTRY_DSN dans .env.local + Vercel env vars. " +
        "Cf. instructions dans lib/monitoring.ts.",
    },
    { status: 500 },
  );
}
