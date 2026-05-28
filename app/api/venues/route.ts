import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import type { VenuePin } from "@/lib/supabase/types";

/**
 * GET /api/venues?bbox=west,south,east,north
 *   [&families=raquette,glisse]
 *   [&sport=padel]
 *   [&feat=lit,indoor,wheelchair,free,paid]
 *   [&limit=2000]
 *
 * Retourne les venues publiés dans la bounding box, optionnellement filtrés
 * par familles, sport, et critères universels. Utilise la RPC venues_in_bbox
 * (migration 0007) qui exploite l'index GIST PostGIS sur venue.geom.
 *
 * `feat` (critères) : valeurs reconnues = lit, indoor, wheelchair, free, paid.
 * Sémantique AND entre critères. Valeurs inconnues ignorées (no-op côté SQL).
 *
 * Limite : 5 000 venues max (cap côté DB pour éviter d'envoyer un MB+ au client).
 */
const KNOWN_FEAT = new Set(["lit", "indoor", "wheelchair", "free", "paid"]);
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const bboxRaw = searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json(
      { error: "bbox=west,south,east,north required" },
      { status: 400 },
    );
  }

  const bbox = bboxRaw.split(",").map(parseFloat);
  if (bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    return NextResponse.json(
      { error: "bbox must be 4 numbers: west,south,east,north" },
      { status: 400 },
    );
  }
  const [west, south, east, north] = bbox;
  if (west >= east || south >= north) {
    return NextResponse.json(
      { error: "bbox invalid: west<east and south<north required" },
      { status: 400 },
    );
  }

  const familiesParam = searchParams.get("families");
  const families = familiesParam
    ? familiesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const sport = searchParams.get("sport")?.trim() || null;

  const featParam = searchParams.get("feat");
  const featRaw = featParam
    ? featParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const feat = featRaw.filter((s) => KNOWN_FEAT.has(s));
  // "free" et "paid" sont mutuellement exclusifs : si les deux sont demandés,
  // aucun venue ne match (fee_required ne peut être à la fois TRUE et FALSE).
  // On laisse passer pour cohérence (count = 0), c'est le comportement attendu
  // si l'utilisateur coche les deux.

  const limitRaw = parseInt(searchParams.get("limit") ?? "2000", 10);
  const limit = Math.max(1, Math.min(Number.isNaN(limitRaw) ? 2000 : limitRaw, 5000));

  try {
    const sb = getSupabaseServerClient();
    const { data, error } = await sb.rpc("venues_in_bbox", {
      west,
      south,
      east,
      north,
      fams: families,
      sport,
      feat: feat.length > 0 ? feat : null,
      max_results: limit,
    });

    if (error) {
      captureException(error, { route: "/api/venues", bbox, families });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { venues: (data ?? []) as VenuePin[], count: (data ?? []).length },
      {
        headers: {
          // Cache navigateur 60s pour les pans rapides de la même zone
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (e) {
    captureException(e, { route: "/api/venues", bbox, families });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
