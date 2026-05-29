import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox, roundBbox, type NormalizedBbox } from "@/lib/bbox";
import type { VenueMapPin } from "@/lib/supabase/types";

/**
 * GET /api/venues?bbox=west,south,east,north
 *   [&families=raquette,glisse]
 *   [&sport=padel]
 *   [&feat=lit,indoor,wheelchair,free,paid]
 *   [&limit=2000]
 *
 * Retourne les venues publiés dans la bounding box, optionnellement filtrés
 * par familles, sport, et critères universels.
 *
 * Quick wins perf (issue #113) :
 *   1. **Payload minimal** : RPC `venues_in_bbox_minimal` (migration 0008)
 *      renvoie strict-6 champs (id, slug, name, lat, lon, family_slug). Aucun
 *      champ supplémentaire — la carte n'a besoin de rien d'autre pour rendre
 *      pins + popup. ~15 % de bytes économisés vs 0007.
 *   2. **Cache-Control CDN** : `public, s-maxage=60, stale-while-revalidate=300`
 *      → Vercel Edge sert les bbox populaires (Paris, Londres…) sans toucher
 *      Supabase. 60s de fraîcheur stricte + 5min de stale acceptable.
 *   3. **Bbox arrondie à 0.01°** (~1 km) AVANT la query : deux viewports
 *      clients très proches produisent la même clé de cache CDN → ratio HIT
 *      drastiquement augmenté sur les zooms/pans incrémentaux.
 *   4. **Edge runtime** : exécution la plus proche du user + cold start ~50ms
 *      vs ~500ms Node. `@supabase/ssr` est Edge-compatible.
 *
 * Gestion des bbox "exotiques" (issue #101, héritée) — déléguée à `parseBbox` :
 *   - bbox mondiale → enveloppe clampée ±179.9/±89.9
 *   - bbox antiméridien (west > east) → split en 2 requêtes + dédup
 *   - bbox normale → clamping à ±179.9/±89.9
 *
 * `feat` (critères) : valeurs reconnues = lit, indoor, wheelchair, free, paid.
 * Sémantique AND entre critères. Valeurs inconnues ignorées (no-op côté SQL).
 *
 * Limite : 5 000 venues max (cap côté DB).
 */
export const runtime = "edge";

const KNOWN_FEAT = new Set(["lit", "indoor", "wheelchair", "free", "paid"]);

type VenueQueryFilters = {
  fams: string[] | null;
  sport: string | null;
  feat: string[] | null;
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

  // Arrondi 0.01° APRÈS validation — la bbox utilisée pour la query RPC et
  // donc pour la clé de cache CDN est normalisée. Le viewport client garde
  // sa précision, c'est uniquement la query qui est "snappée" à la grille
  // de 1 km.
  const bbox = roundBbox(parsed);

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

  const filters: VenueQueryFilters = {
    fams: families,
    sport,
    feat: feat.length > 0 ? feat : null,
    limit,
  };

  try {
    const venues = await fetchVenues(bbox, filters);
    return NextResponse.json(
      { venues, count: venues.length },
      {
        headers: {
          // Cache CDN Vercel + navigateur (issue #113).
          //   - s-maxage=60                 : edge CDN sert pendant 60s
          //   - stale-while-revalidate=300  : sert l'ancien jusqu'à 5min
          //     pendant la revalidation en arrière-plan → 0 wait pour le user
          // 60s suffit pour propager les nouveaux venues (les updates admin
          // sont rares) ; le SWR amortit les pics de trafic sur les bbox
          // populaires (Paris, Londres, Tokyo…).
          "Cache-Control":
            "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (e) {
    captureException(e, { route: "/api/venues", bbox: bboxRaw, families });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Dispatche la requête venues selon le kind de bbox normalisée.
 * Throw en cas d'erreur Supabase pour que le caller capture l'exception.
 */
async function fetchVenues(
  bbox: Exclude<NormalizedBbox, { kind: "error" }>,
  filters: VenueQueryFilters,
): Promise<VenueMapPin[]> {
  const sb = getSupabaseServerClient();

  if (bbox.kind === "global") {
    // Bbox mondiale : on appelle la RPC avec une enveloppe clampée ±179.9/±89.9
    // qui couvre toutes les venues réalistes tout en évitant l'erreur antipodale
    // de ST_MakeEnvelope sur exactement ±180. Plus simple qu'une nouvelle RPC
    // sans filtre spatial, et exploite le même index GIST.
    const { data, error } = await sb.rpc("venues_in_bbox_minimal", {
      west: -179.9,
      south: -89.9,
      east: 179.9,
      north: 89.9,
      fams: filters.fams,
      sport: filters.sport,
      feat: filters.feat,
      max_results: filters.limit,
    });
    if (error) throw error;
    return (data ?? []) as VenueMapPin[];
  }

  if (bbox.kind === "antimeridian") {
    // Bbox traversant l'antiméridien : on lance 2 requêtes RPC en parallèle
    // sur les 2 moitiés [west, 180] et [-180, east], puis on dédup par id.
    // Le total est cappé au `limit` demandé (pas 2×limit).
    const [r1, r2] = await Promise.all([
      sb.rpc("venues_in_bbox_minimal", {
        west: bbox.west1,
        south: bbox.south,
        east: bbox.east1,
        north: bbox.north,
        fams: filters.fams,
        sport: filters.sport,
        feat: filters.feat,
        max_results: filters.limit,
      }),
      sb.rpc("venues_in_bbox_minimal", {
        west: bbox.west2,
        south: bbox.south,
        east: bbox.east2,
        north: bbox.north,
        fams: filters.fams,
        sport: filters.sport,
        feat: filters.feat,
        max_results: filters.limit,
      }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;

    const seen = new Set<string>();
    const merged: VenueMapPin[] = [];
    for (const v of [
      ...((r1.data ?? []) as VenueMapPin[]),
      ...((r2.data ?? []) as VenueMapPin[]),
    ]) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      merged.push(v);
      if (merged.length >= filters.limit) break;
    }
    return merged;
  }

  // Bbox normale, valeurs déjà clampées par parseBbox + arrondies par roundBbox.
  const { data, error } = await sb.rpc("venues_in_bbox_minimal", {
    west: bbox.west,
    south: bbox.south,
    east: bbox.east,
    north: bbox.north,
    fams: filters.fams,
    sport: filters.sport,
    feat: filters.feat,
    max_results: filters.limit,
  });
  if (error) throw error;
  return (data ?? []) as VenueMapPin[];
}
