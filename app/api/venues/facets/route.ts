import { NextResponse } from "next/server";
import { getSupabaseAnonEdgeClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox, type NormalizedBbox } from "@/lib/bbox";
import { type FacetRow, mergeFacets, pivotFacets } from "@/lib/facets";

/**
 * Runtime Edge — même rationale que /api/venues (cf. ce fichier) : pas de cold
 * start, client `createClient` (@supabase/supabase-js) compatible Edge, pas de
 * service_role dans ce chemin public (#225). La RPC `venues_facets_in_bbox`
 * (migration 0019) filtre is_published + deleted_at en interne.
 */
export const runtime = "edge";

/** Arrondi bbox 2 décimales (~1.1 km) — aligne la clé de cache CDN, cf. #113. */
const roundCoord = (n: number) => Math.round(n * 100) / 100;

const KNOWN_FEAT = new Set(["lit", "indoor", "wheelchair", "free", "paid"]);
const KNOWN_SURFACES = new Set(["clay", "concrete", "synthetic", "grass", "parquet", "sand"]);

/**
 * GET /api/venues/facets?bbox=west,south,east,north
 *   [&families=raquette,glisse]
 *   [&feat=lit,indoor]
 *   [&surface=clay,grass]
 *
 * Compteurs à facettes pour le panneau de filtres (#279). Pour chaque option
 * (famille / critère / surface) du viewport, le nombre de lieux qui
 * matcheraient en respectant les AUTRES groupes de filtres actifs (sémantique
 * faceted, style Amazon — évite les culs-de-sac). Cf. migration 0019.
 *
 * Réponse :
 *   { family: {raquette: 1234, …}, criteria: {lit: 88, …}, surface: {clay: 42, …} }
 *
 * Pas de `zoom`/mode agrégats : les facettes n'ont de sens qu'en mode POI
 * (zoom où le panneau de filtres est pertinent). Le client peut choisir de ne
 * pas afficher les compteurs à bas zoom.
 *
 * Cache court (comme le mode POI de /api/venues) : les counts bougent avec le
 * pan/zoom mais l'arrondi bbox mutualise les micro-pans.
 */
type FacetFilters = {
  fams: string[] | null;
  feat: string[] | null;
  surfaces: string[] | null;
};

/** Params de la RPC venues_facets_in_bbox (migration 0019). */
type FacetRpcParams = {
  west: number;
  south: number;
  east: number;
  north: number;
  fams?: string[];
  feat?: string[];
  surfaces?: string[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const bboxRaw = searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json({ error: "bbox=west,south,east,north required" }, { status: 400 });
  }

  const parsed = parseBbox(bboxRaw);
  if (parsed.kind === "error") {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const familiesParam = searchParams.get("families");
  const families = familiesParam
    ? familiesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const featParam = searchParams.get("feat");
  const feat = (
    featParam
      ? featParam
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  ).filter((s) => KNOWN_FEAT.has(s));

  const surfaceParam = searchParams.get("surface");
  const surfaces = (
    surfaceParam
      ? surfaceParam
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  ).filter((s) => KNOWN_SURFACES.has(s));

  const filters: FacetFilters = {
    fams: families && families.length > 0 ? families : null,
    feat: feat.length > 0 ? feat : null,
    surfaces: surfaces.length > 0 ? surfaces : null,
  };

  try {
    const rows = await fetchFacets(parsed, filters);
    const body = pivotFacets(rows);
    return NextResponse.json(body, {
      headers: {
        // Cache court, aligné sur le mode POI de /api/venues : les facettes
        // suivent les venues à granularité unitaire. L'arrondi bbox + le SWR
        // absorbent les micro-pans répétés.
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    captureException(e, {
      route: "/api/venues/facets",
      bbox: bboxRaw,
      families,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Appelle la RPC `venues_facets_in_bbox` (migration 0019). Gère les bbox
 * global / antiméridien comme /api/venues : pour le global on clampe à la bbox
 * mondiale ; pour l'antiméridien on additionne les facettes des 2 moitiés.
 *
 * Note antiméridien : on somme `n` par (type,key). Un lieu ne peut pas être
 * dans les 2 moitiés (longitudes disjointes), donc pas de double comptage
 * inter-moitiés — sauf pour la facette `surface` qui compte DISTINCT venue par
 * moitié ; là aussi les venues sont disjointes entre les 2 fenêtres spatiales.
 */
async function fetchFacets(
  bbox: Exclude<NormalizedBbox, { kind: "error" }>,
  filters: FacetFilters
): Promise<FacetRow[]> {
  const sb = getSupabaseAnonEdgeClient();

  // `venues_facets_in_bbox` (migration 0019) pas encore dans les types générés
  // (régénérés depuis la prod, où 0019 n'est pas appliquée). Typage explicite
  // en attendant l'application + regen des types — même pattern que
  // venues_aggregates dans /api/venues (#114/#178).
  const call = (params: FacetRpcParams) =>
    (
      sb.rpc as unknown as (
        fn: "venues_facets_in_bbox",
        params: FacetRpcParams
      ) => Promise<{ data: FacetRow[] | null; error: { message: string } | null }>
    )("venues_facets_in_bbox", params);

  const baseParams = {
    fams: filters.fams ?? undefined,
    feat: filters.feat ?? undefined,
    surfaces: filters.surfaces ?? undefined,
  };

  if (bbox.kind === "global") {
    const { data, error } = await call({
      west: -179.9,
      south: -89.9,
      east: 179.9,
      north: 89.9,
      ...baseParams,
    });
    if (error) throw error;
    return data ?? [];
  }

  if (bbox.kind === "antimeridian") {
    const [r1, r2] = await Promise.all([
      call({
        west: roundCoord(bbox.west1),
        south: roundCoord(bbox.south),
        east: roundCoord(bbox.east1),
        north: roundCoord(bbox.north),
        ...baseParams,
      }),
      call({
        west: roundCoord(bbox.west2),
        south: roundCoord(bbox.south),
        east: roundCoord(bbox.east2),
        north: roundCoord(bbox.north),
        ...baseParams,
      }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    return mergeFacets(r1.data ?? [], r2.data ?? []);
  }

  const { data, error } = await call({
    west: roundCoord(bbox.west),
    south: roundCoord(bbox.south),
    east: roundCoord(bbox.east),
    north: roundCoord(bbox.north),
    ...baseParams,
  });
  if (error) throw error;
  return data ?? [];
}
