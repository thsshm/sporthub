/**
 * Cron : rafraîchit la vue matérialisée `mv_top_cities_by_venue_count`
 * (migration 0029) qui alimente le RPC `top_cities_by_venue_count` — section
 * "villes" de la home et page /villes.
 *
 * La MV précalcule le classement des villes par nombre de venues publiées :
 * l'agrégat live (GROUP BY sur ~371k venues) timeoutait en prod (seq scan
 * ~30s). On l'a figé dans une MV et on la rafraîchit ici périodiquement.
 *
 * Appelle simplement le RPC SECURITY DEFINER `refresh_top_cities_mv()`
 * (REFRESH non-concurrent — CONCURRENTLY interdit dans une fonction). Le job
 * tourne hebdo hors pic (lundi 07:00 UTC, après les crons d'import), donc le
 * bref AccessExclusive lock sur la MV est sans impact utilisateur notable.
 *
 * Auth : header `Authorization: Bearer <CRON_SECRET>` (injecté par Vercel).
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// REFRESH d'une MV de ~25k lignes recalculée depuis ~371k venues : ~30-40s.
export const maxDuration = 60;

const EVENT_NAME = "cron.refresh-top-cities.completed";

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  try {
    const sb = getSupabaseAdminClient();
    const { error } = await sb.rpc("refresh_top_cities_mv");
    if (error) throw error;
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-top-cities" });
    const duration_ms = Date.now() - startedAt;
    logCronCompleted({
      event: EVENT_NAME,
      upserted: 0,
      failed: 1,
      duration_ms,
      extra: { error: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json(
      { ok: false, duration_ms, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  const duration_ms = Date.now() - startedAt;
  logCronCompleted({ event: EVENT_NAME, upserted: 1, failed: 0, duration_ms });
  return NextResponse.json({ ok: true, duration_ms });
}
