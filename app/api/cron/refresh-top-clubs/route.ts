/**
 * Cron : rafraîchit la vue matérialisée `mv_top_clubs_by_sport` (migration
 * 0033) qui alimente le RPC `top_clubs_by_sport` — pages /disciplines/{sport}.
 *
 * La MV précalcule le classement des clubs par nombre de courts, par sport :
 * le tri live (`ORDER BY venue.courts_count` non indexé sur la jointure
 * venue ⋈ venue_sport) timeoutait en prod (57014) → pages « 0 clubs » (#331).
 * On l'a figé dans une MV et on la rafraîchit ici périodiquement.
 *
 * Appelle simplement le RPC SECURITY DEFINER `refresh_top_clubs_by_sport_mv()`
 * (REFRESH non-concurrent — CONCURRENTLY interdit dans une fonction). Le job
 * tourne hebdo hors pic (après les crons d'import), donc le bref
 * AccessExclusive lock sur la MV est sans impact utilisateur notable.
 *
 * Auth : header `Authorization: Bearer <CRON_SECRET>` (injecté par Vercel).
 * Issue : https://github.com/thsshm/sporthub/issues/331
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// REFRESH d'une MV recalculée depuis la jointure venue ⋈ venue_sport : ~30-40s.
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
