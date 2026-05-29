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

  // Clamp aux limites "safe" pour éviter l'erreur PostGIS "Antipodal
  // (180 degrees long) edge detected" qui survient quand ST_MakeEnvelope
  // reçoit exactement [-180, 180] (cf. issue #101 : bbox mondiale plantait
  // /api/venues en 500 sur le premier rendu dézoomé). 179.9 est suffisant
  // pour préserver la précision visuelle (~11 km à l'équateur).
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));
  const westC = clamp(west, -179.9, 179.9);
  const eastC = clamp(east, -179.9, 179.9);
  const southC = clamp(south, -89.9, 89.9);
  const northC = clamp(north, -89.9, 89.9);

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
      west: westC,
      south: southC,
      east: eastC,
      north: northC,
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
          // Cache navigateur + edge CDN. Une bbox+filtres identiques renvoie
          // le même résultat tant que la DB n'a pas changé.
          //   - max-age=300       : cache navigateur 5min (pans/zooms rapides)
          //   - s-maxage=300      : cache edge Vercel 5min
          //   - stale-while-revalidate=3600 : sert l'ancien pendant 1h pendant
          //     la revalidation en arrière-plan → 0 wait pour le user
          "Cache-Control":
            "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (e) {
    captureException(e, { route: "/api/venues", bbox, families });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
