import { NextResponse } from "next/server";
import { getSupabaseEdgeClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import type { VenueEnrichments } from "@/lib/supabase/types";

/**
 * GET /api/venue-enrichments/[slug]
 *
 * Retourne uniquement les champs d'enrichissement Wikimedia/Wikipedia d'un
 * venue (photo_url, description, wikipedia_url, wikipedia_label) — utilisé
 * par la popup de la carte (#107) pour lazy-load les détails au clic sans
 * gonfler le payload de `/api/venues` (qui retourne ~2 000 pins par bbox).
 *
 * Réponse :
 *   200 OK   { photo_url?, description?, wikipedia_url?, wikipedia_label? }
 *   404      venue non publié / introuvable
 *
 * Cache HTTP edge agressif (24h SWR) — les enrichissements changent rarement.
 */
export const runtime = "edge";

type EnrichmentsResponse = Pick<
  VenueEnrichments,
  "photo_url" | "description" | "wikipedia_url" | "wikipedia_label"
>;

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const slug = (params.slug || "").trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  try {
    // Edge runtime : getSupabaseEdgeClient (service_role sans next/headers),
    // PAS getSupabaseAdminClient qui importe next/headers → KO en edge (#230).
    const sb = getSupabaseEdgeClient();
    const { data, error } = await sb
      .from("venue")
      .select("enrichments")
      .eq("slug", slug)
      .eq("is_published", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const e = (data.enrichments ?? {}) as VenueEnrichments;
    const body: EnrichmentsResponse = {
      photo_url: e.photo_url,
      description: e.description,
      wikipedia_url: e.wikipedia_url,
      wikipedia_label: e.wikipedia_label,
    };
    return NextResponse.json(body, {
      headers: {
        // Cache long : les enrichments Wikidata sont stables.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    captureException(e, { route: "/api/venue-enrichments", slug });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
