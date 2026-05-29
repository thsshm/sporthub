/**
 * Route Handler : favoris persistés en DB pour les users authentifiés.
 *
 * Issue #91 (phase 3).
 *
 *   GET    /api/favorites          → [{ venue_id, created_at }]  (401 si pas auth)
 *   POST   /api/favorites          → { venue_id }    insert idempotent (ON CONFLICT)
 *   DELETE /api/favorites          → { venue_id }    suppression
 *
 * Source de vérité = la table `user_favorite` (cf. migration 0010).
 * RLS active : la policy SELECT/INSERT/DELETE filtre déjà par `auth.uid()`,
 * mais on check explicitement `user` côté Route Handler pour renvoyer un
 * 401 propre plutôt qu'un 200/empty (UX + audit).
 *
 * Pour les visiteurs non authentifiés, le client garde le fallback
 * localStorage (clé `sporthub-favorites`, cf. MapClient). Le helper
 * `lib/favorites-sync.ts` synchronise localStorage → DB au login.
 */
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";

type FavoriteBody = {
  venue_id?: unknown;
};

function isUuid(value: unknown): value is string {
  // UUID v4 strict-ish — suffit pour rejeter les payloads bidon avant DB hit.
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export async function GET() {
  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Auth requise" }, { status: 401 });
  }

  try {
    const { data, error } = await sb
      .from("user_favorite")
      .select("venue_id, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json(
      { favorites: data ?? [] },
      {
        headers: {
          // Données privées par utilisateur → jamais cache CDN. Mais le
          // navigateur peut se garder un cache court pour les allers-retours
          // (page /favoris → /venue/X → back). `private` interdit tout
          // partage de cache.
          "Cache-Control": "private, no-cache",
        },
      },
    );
  } catch (e) {
    captureException(e, { route: "GET /api/favorites" });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: FavoriteBody;
  try {
    body = (await request.json()) as FavoriteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isUuid(body.venue_id)) {
    return NextResponse.json(
      { error: "venue_id (uuid) requis" },
      { status: 400 },
    );
  }

  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Auth requise" }, { status: 401 });
  }

  try {
    // Idempotence : la PK (user_id, venue_id) déduplique nativement.
    // upsert avec onConflict=user_id,venue_id + ignoreDuplicates pour
    // n'ajouter que si pas déjà là (équivalent ON CONFLICT DO NOTHING).
    const { error } = await sb
      .from("user_favorite")
      .upsert(
        { user_id: user.id, venue_id: body.venue_id },
        { onConflict: "user_id,venue_id", ignoreDuplicates: true },
      );

    if (error) throw error;

    return NextResponse.json({ ok: true, venue_id: body.venue_id }, { status: 201 });
  } catch (e) {
    captureException(e, { route: "POST /api/favorites", venue_id: body.venue_id });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let body: FavoriteBody;
  try {
    body = (await request.json()) as FavoriteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isUuid(body.venue_id)) {
    return NextResponse.json(
      { error: "venue_id (uuid) requis" },
      { status: 400 },
    );
  }

  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Auth requise" }, { status: 401 });
  }

  try {
    const { error } = await sb
      .from("user_favorite")
      .delete()
      .eq("user_id", user.id)
      .eq("venue_id", body.venue_id);

    if (error) throw error;

    return NextResponse.json({ ok: true, venue_id: body.venue_id });
  } catch (e) {
    captureException(e, { route: "DELETE /api/favorites", venue_id: body.venue_id });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
