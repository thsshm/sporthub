import { NextResponse } from "next/server";
import { getSupabaseAnonEdgeClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox, type NormalizedBbox } from "@/lib/bbox";
import type { ClubPin } from "@/lib/supabase/types";

/**
 * Runtime Edge — même rationale que /api/venues (cf. #167) : suppression
 * du cold start serverless pour servir l'agrégat clubs au plus près du user.
 */
export const runtime = "edge";

/**
 * Cap dur côté serveur : on n'envoie jamais plus de 5000 clubs au client,
 * même si la bbox est très large (sanity guard équivalent à /api/venues).
 */
const HARD_LIMIT = 5000;

/**
 * GET /api/venues/clubs?bbox=west,south,east,north
 *   [&families=raquette,glisse]
 *   [&limit=2000]
 *
 * Retourne les clubs dans la bounding box, avec `courts_count` (nombre de
 * venues rattachés à chaque club). Utilisé par la carte au zoom < 16 pour
 * afficher 1 pin "club" plus gros + badge `[N] courts` par établissement
 * (cf. #130 vue club V1).
 *
 * Filtres :
 *   - `families` (CSV) — filtre côté `club.family_slug`. Si omis ou vide, pas de filtre.
 *
 * Gestion des bbox "exotiques" (cf. #101) : déléguée à `parseBbox` comme dans
 * /api/venues — kind=global / antimeridian / normal. Le COUNT des venues
 * rattachés est calculé en 2 requêtes (clubs + venues IN clubIds) pour rester
 * simple à déployer sans nouveau RPC.
 *
 * Cache : public 5min navigateur + edge, SWR 1h. La donnée bouge rarement
 * (clustering offline batch). Si les venues bougent, le `courts_count` peut
 * être périmé jusqu'à 5min — acceptable pour une vue agrégée.
 */
type ClubQueryFilters = {
  fams: string[] | null;
  limit: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const bboxRaw = searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json(
      { error: "bbox=west,south,east,north required" },
      { status: 400 },
    );
  }

  const parsed = parseBbox(bboxRaw);
  if (parsed.kind === "error") {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const familiesParam = searchParams.get("families");
  const families = familiesParam
    ? familiesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const limitRaw = parseInt(searchParams.get("limit") ?? "2000", 10);
  const limit = Math.max(
    1,
    Math.min(Number.isNaN(limitRaw) ? 2000 : limitRaw, HARD_LIMIT),
  );

  const filters: ClubQueryFilters = {
    fams: families,
    limit,
  };

  try {
    const clubs = await fetchClubs(parsed, filters);
    return NextResponse.json(
      { clubs, count: clubs.length },
      {
        headers: {
          // Mêmes timings que /api/venues — la donnée club bouge moins, on
          // pourrait monter, mais on reste consistant pour la lisibilité.
          "Cache-Control":
            "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (e) {
    captureException(e, {
      route: "/api/venues/clubs",
      bbox: bboxRaw,
      families,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Dispatche la requête clubs selon le kind de bbox normalisée.
 * Throw en cas d'erreur Supabase pour que le caller capture l'exception.
 *
 * Note implémentation : Supabase JS client ne permet pas un GROUP BY direct
 * sans RPC. Pour la V1, on fait 2 requêtes :
 *   1. SELECT * FROM club WHERE lat/lon dans bbox [+ filters]
 *   2. SELECT club_id FROM venue WHERE club_id IN (…) — on compte côté JS
 *
 * C'est plus simple à déployer (pas de migration RPC bloquante) et largement
 * suffisant pour la V1 : 2 requêtes ~50ms chacune, indexées. Une optimisation
 * future serait un RPC `clubs_in_bbox` avec GROUP BY direct côté SQL.
 */
async function fetchClubs(
  bbox: Exclude<NormalizedBbox, { kind: "error" }>,
  filters: ClubQueryFilters,
): Promise<ClubPin[]> {
  // Client anon (clé publique) + RPC `clubs_in_bbox` SECURITY DEFINER
  // (migration 0015). Plus de service_role sur ce chemin public (#225).
  // La RPC lit `club` + compte les venues rattachés (is_published=true,
  // deleted_at IS NULL) en une passe SQL — aucune fuite, pas de pagination
  // PostgREST à gérer côté client, pas de N+1.
  const sb = getSupabaseAnonEdgeClient();

  // `clubs_in_bbox` n'est pas dans les types générés tant que la migration 0015
  // n'est pas appliquée + types régénérés. Wrapper typé explicite en attendant.
  type ClubsParams = {
    bbox_kind: "global" | "normal";
    west: number | null;
    south: number | null;
    east: number | null;
    north: number | null;
    fams: string[] | null;
    max_results: number;
  };
  const callClubs = (params: ClubsParams) =>
    (
      sb.rpc as unknown as (
        fn: "clubs_in_bbox",
        params: ClubsParams,
      ) => Promise<{ data: ClubPin[] | null; error: { message: string } | null }>
    )("clubs_in_bbox", params);

  if (bbox.kind === "global") {
    const { data, error } = await callClubs({
      bbox_kind: "global",
      west: null,
      south: null,
      east: null,
      north: null,
      fams: filters.fams,
      max_results: filters.limit,
    });
    if (error) throw error;
    return data ?? [];
  }

  if (bbox.kind === "antimeridian") {
    // 2 moitiés [west1, east1] ∪ [west2, east2], dédup par id côté Node.
    const [r1, r2] = await Promise.all([
      callClubs({
        bbox_kind: "normal",
        west: bbox.west1,
        south: bbox.south,
        east: bbox.east1,
        north: bbox.north,
        fams: filters.fams,
        max_results: filters.limit,
      }),
      callClubs({
        bbox_kind: "normal",
        west: bbox.west2,
        south: bbox.south,
        east: bbox.east2,
        north: bbox.north,
        fams: filters.fams,
        max_results: filters.limit,
      }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    const seen = new Set<string>();
    const merged: ClubPin[] = [];
    for (const row of [...(r1.data ?? []), ...(r2.data ?? [])]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= filters.limit) break;
    }
    return merged;
  }

  // Bbox normale
  const { data, error } = await callClubs({
    bbox_kind: "normal",
    west: bbox.west,
    south: bbox.south,
    east: bbox.east,
    north: bbox.north,
    fams: filters.fams,
    max_results: filters.limit,
  });
  if (error) throw error;
  return data ?? [];
}
