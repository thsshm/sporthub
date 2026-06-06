/**
 * Cron : rafraîchit la vue matérialisée `mv_disciplines_ranking` (migration
 * 0034) qui alimente le RPC `top_discipline_venues` — pages /disciplines/{sport}
 * (classement national des clubs par nombre de courts).
 *
 * La MV précalcule le top 50 par sport trié par `courts_count`. Le tri live sur
 * le set joint `venue × venue_sport` (tennis ≈ 40k) timeoutait en prod (57014,
 * `courts_count` non indexé). On l'a figé dans une MV et on la rafraîchit ici.
 *
 * Appelle le RPC SECURITY DEFINER `refresh_disciplines_ranking_mv()` (REFRESH
 * non-concurrent — CONCURRENTLY interdit dans une fonction). Hebdo, hors pic
 * (lundi 08:00 UTC, après refresh-top-cities à 07:00) → bref lock sans impact.
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
// REFRESH d'une MV de ≤ quelques milliers de lignes (sous-ensemble court-compté)
// recalculée depuis venue : court, mais on garde la marge des autres refresh.
export const maxDuration = 60;

const EVENT_NAME = "cron.refresh-disciplines.completed";

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  try {
    const sb = getSupabaseAdminClient();
    const { error } = await sb.rpc("refresh_disciplines_ranking_mv");
    if (error) throw error;
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-disciplines" });
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
