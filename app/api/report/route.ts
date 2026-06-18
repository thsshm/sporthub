import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { validateReportInput } from "@/lib/venue/report";

/**
 * POST /api/report (#613) — signalement public d'erreur sur une venue.
 * Sans compte requis : la table venue_report a une policy RLS INSERT pour anon
 * (migration 0067). On valide strictement (type borné + note plafonnée) avant
 * insert. Aucune lecture publique (pas de policy SELECT).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateReportInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  try {
    // venue_report est neuve → absente des types générés ; cast localisé.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any)
      .from("venue_report")
      .insert({
        venue_id: parsed.value.venue_id,
        issue_type: parsed.value.issue_type,
        note: parsed.value.note,
        reporter_user_id: user?.id ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (e) {
    captureException(e, { route: "/api/report", venue_id: parsed.value.venue_id });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
