/**
 * Route admin pour déclencher manuellement les 4 crons d'un coup.
 *
 * Usage : POST /api/admin/cron/run-all   (avec session admin)
 *
 * Cas d'usage :
 *   - Debug post-deploy ("est-ce que mes crons tournent comme prévu ?")
 *   - Rattrapage si Vercel a manqué un slot (panne, push de migration, etc.)
 *   - Smoke test après changement de logique dans un handler
 *
 * Implémentation : on appelle les 4 routes `/api/cron/refresh-*` en HTTP
 * interne, avec le header Authorization construit depuis `CRON_SECRET`.
 * Choix volontaire vs import direct : ça garantit qu'on exerce le MÊME
 * code path qu'un appel Vercel cron (auth handler, runtime, etc.), donc
 * pas de divergence sneaky entre "debug" et "production".
 *
 * Protection : `requireAdmin()` — l'user doit être loggué avec
 * ADMIN_EMAIL. Une session non-admin → 403.
 *
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { captureException } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// On lance 4 crons séquentiels, chacun pouvant aller à ~50s sur Hobby
// → cette route peut dépasser 60s. Sur Hobby, on tapera le timeout mais
// les crons individuels auront tourné en arrière-plan ; on a leur statut
// dans Vercel logs. Sur Pro, on relève maxDuration à 300s pour avoir un
// rapport synchrone complet.
export const maxDuration = 60;

const CRON_PATHS = [
  "/api/cron/refresh-hyrox",
  "/api/cron/refresh-paragliding",
  "/api/cron/refresh-diving",
  "/api/cron/refresh-wikidata",
] as const;

type CronResult = {
  path: string;
  status: number;
  body: unknown;
  error?: string;
};

function getBaseUrl(request: Request): string {
  // VERCEL_URL est sans schéma (`sporthub.vercel.app`), VERCEL_PROJECT_PRODUCTION_URL
  // pareil. En local on a NEXT_PUBLIC_BASE_URL ou on tombe sur request.url.
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  // Dev local : reconstruit depuis l'URL de la requête courante.
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    // requireAdmin throw "Forbidden: not authenticated" ou "Forbidden: not admin"
    const msg = err instanceof Error ? err.message : "Forbidden";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET non configuré — impossible de déclencher les crons." },
      { status: 500 },
    );
  }

  const baseUrl = getBaseUrl(request);
  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    Accept: "application/json",
  };

  const results: CronResult[] = [];
  for (const path of CRON_PATHS) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      results.push({ path, status: res.status, body });
    } catch (err) {
      captureException(err, { route: "/api/admin/cron/run-all", target: path });
      results.push({
        path,
        status: 0,
        body: null,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const allOk = results.every((r) => r.status >= 200 && r.status < 300);
  return NextResponse.json(
    { ok: allOk, results },
    { status: allOk ? 200 : 207 }, // 207 Multi-Status si au moins un a échoué
  );
}
