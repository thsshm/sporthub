import { NextResponse } from "next/server";
import { getSupabaseEdgeClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import type { VenuePin } from "@/lib/supabase/types";

/**
 * Runtime Edge — cohérent avec /api/venues et /api/venues/clubs (cf. #167).
 */
export const runtime = "edge";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/venues/clubs/[id]
 *
 * Retourne les venues (courts individuels) rattachés à un club, pour la popup
 * "vue club" : au clic sur un ClubMarker, on liste les courts du club avec un
 * lien vers chaque fiche /venue/[slug] (cf. #130 / palier 4 #311).
 *
 * Lecture seule, données publiques (venues publiés non supprimés). Cap 200
 * courts (un club n'a jamais 200 installations en pratique — garde-fou).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const clubId = params.id;
  if (!UUID_RE.test(clubId)) {
    return NextResponse.json({ error: "invalid club id" }, { status: 400 });
  }

  try {
    const sb = getSupabaseEdgeClient();
    const { data, error } = await sb
      .from("venue")
      .select("id, slug, name, lat, lon, family_slug, primary_sport_slug")
      .eq("club_id", clubId)
      .eq("is_published", true)
      .is("deleted_at", null)
      .order("name")
      .limit(200);
    if (error) throw error;

    const venues = (data ?? []) as VenuePin[];
    return NextResponse.json(
      { venues, count: venues.length },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
        },
      }
    );
  } catch (e) {
    captureException(e, { route: "/api/venues/clubs/[id]", clubId });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
