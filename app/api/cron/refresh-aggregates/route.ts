/**
 * Cron : rafraîchit les vues matérialisées d'agrégats carte `mv_venue_country_agg`
 * et `mv_venue_grid_agg` (migration 0039) qui alimentent le RPC `venues_aggregates`
 * (bulles pays + cellules de grille au zoom < 10).
 *
 * Ces MV figent les comptes par pays / cellule pour éviter le scan live sur
 * `venue` (267k) qui timeoutait (57014, cf. #387). On les rafraîchit ici après
 * les imports pour que la vue dézoomée reflète les nouvelles venues.
 *
 * Appelle le RPC SECURITY DEFINER `refresh_venue_aggregates()` (REFRESH
 * non-concurrent — CONCURRENTLY interdit dans une fonction). Hebdo, hors pic
 * (lundi 09:00 UTC, après refresh-top-clubs à 08:30) → bref lock sans impact.
 *
 * Auth : header `Authorization: Bearer <CRON_SECRET>` (injecté par Vercel).
 * Issue : https://github.com/thsshm/sporthub/issues/387
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EVENT_NAME = "cron.refresh-aggregates.completed";

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  try {
    const sb = getSupabaseAdminClient();
    // `refresh_venue_aggregates` pas (encore) dans les types générés.
    const { error } = await (
      sb.rpc as unknown as (
        fn: "refresh_venue_aggregates"
      ) => Promise<{ error: { message: string } | null }>
    )("refresh_venue_aggregates");
    if (error) throw error;
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-aggregates" });
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
      { status: 500 }
    );
  }

  const duration_ms = Date.now() - startedAt;
  logCronCompleted({ event: EVENT_NAME, upserted: 1, failed: 0, duration_ms });
  return NextResponse.json({ ok: true, duration_ms });
}
