/**
 * Cron : rafraîchit la vue matérialisée `mv_top_clubs_by_sport` (migration
 * 0038) qui alimente le RPC `top_clubs_by_sport` — classement par club des
 * pages /disciplines/{sport} (#366).
 *
 * La MV précalcule le top 50 clubs par sport (clubs classés par nombre de
 * courts du sport). On la rafraîchit ici périodiquement via le RPC SECURITY
 * DEFINER `refresh_top_clubs_by_sport_mv()` (REFRESH non-concurrent — interdit
 * dans une fonction). Job hebdo hors pic → bref AccessExclusive lock sans
 * impact notable.
 *
 * Auth : header `Authorization: Bearer <CRON_SECRET>` (injecté par Vercel).
 * Issue : https://github.com/thsshm/sporthub/issues/366
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EVENT_NAME = "cron.refresh-top-clubs.completed";

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  try {
    const sb = getSupabaseAdminClient();
    const { error } = await sb.rpc("refresh_top_clubs_by_sport_mv");
    if (error) throw error;
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-top-clubs" });
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
