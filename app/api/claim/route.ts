import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";

type Body = {
  venue_id?: string;
  email?: string;
  name?: string;
  role?: string;
  proof_text?: string;
  proof_url?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.venue_id || !body.email || body.email.length < 5) {
    return NextResponse.json(
      { error: "venue_id et email requis" },
      { status: 400 },
    );
  }

  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  try {
    const { data, error } = await sb
      .from("claim_request")
      .insert({
        venue_id: body.venue_id,
        requester_user_id: user?.id ?? null,
        requester_email: body.email.trim(),
        requester_name: body.name?.trim() || null,
        requester_role: body.role?.trim() || null,
        proof_text: body.proof_text?.trim() || null,
        proof_url: body.proof_url?.trim() || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      // RLS : nécessite auth (cf. migration 0001). Renvoie 401 si pas auth.
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Authentification requise pour soumettre un claim" },
          { status: 401 },
        );
      }
      throw error;
    }

    return NextResponse.json({ id: data.id, status: "pending" }, { status: 201 });
  } catch (e) {
    captureException(e, { route: "/api/claim", venue_id: body.venue_id });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
