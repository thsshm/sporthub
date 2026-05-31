import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox } from "@/lib/bbox";

/**
 * Runtime Edge — même raison que /api/venues (cf. #167).
 */
export const runtime = "edge";

const roundCoord = (n: number) => Math.round(n * 1000) / 1000;

/**
 * GET /api/venues/clustered?bbox=west,south,east,north&zoom=N
 *   [&families=raquette,glisse]
 *   [&sport=padel]
 *
 * Agrégation serveur selon le niveau de zoom (issue #114) :
 *   - zoom < 6   → 1 bulle par pays (venues_clustered_country)
 *   - 6 ≤ zoom < 10 → grille ST_SnapToGrid (venues_clustered_grid)
 *   - zoom ≥ 10  → POI individuels via venues_in_bbox (comportement historique)
 *
 * Paramètre `zoom` OBLIGATOIRE pour les tiers < 10. Absent → fallback zoom 10
 * (pins individuels). Compatible avec le client qui envoie toujours zoom.
 *
 * Cache agressif pour les agrégats (rarement stale) :
 *   - zoom < 6  : s-maxage=3600, stale-while-revalidate=86400
 *   - 6 ≤ zoom < 10 : s-maxage=900, stale-while-revalidate=3600
 *   - zoom ≥ 10 : s-maxage=300, stale-while-revalidate=3600
 *
 * NOTE overlap avec #113 : cette route est NOUVELLE (/api/venues/clustered),
 * elle ne modifie PAS /api/venues/route.ts. Zéro conflit avec #113.
 */

export type ClusteredVenue = {
  cluster_id: string | null;
  count: number;
  lat: number;
  lon: number;
  is_cluster: boolean;
  /** Null pour les agrégats. */
  id: string | null;
  slug: string | null;
  name: string | null;
  family_slug: string | null;
  primary_sport_slug: string | null;
};

export type ClusteredResponse = {
  venues: ClusteredVenue[];
  count: number;
  zoom: number;
  tier: "country" | "grid" | "pins";
};

/** Taille de cellule en degrés selon le zoom (zoom 6-9). */
function cellDegForZoom(zoom: number): number {
  if (zoom < 8) return 5.0; // zoom 6-7 : cellule ~500 km
  return 1.0; // zoom 8-9 : cellule ~100 km
}

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

  const zoomRaw = parseFloat(searchParams.get("zoom") ?? "10");
  const zoom = Number.isNaN(zoomRaw) ? 10 : Math.max(0, Math.min(zoomRaw, 22));

  const familiesParam = searchParams.get("families");
  const fams: string[] | null = familiesParam
    ? familiesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const sport = searchParams.get("sport")?.trim() || null;

  // Extraire des coords normalisées quel que soit le kind de bbox.
  // Pour "global" et "antimeridian", on utilise l'enveloppe mondiale.
  // Le tier pays (zoom < 6) et grille (6-9) tolèrent une bbox large.
  let west: number, south: number, east: number, north: number;
  if (parsed.kind === "normal") {
    west = roundCoord(parsed.west);
    south = roundCoord(parsed.south);
    east = roundCoord(parsed.east);
    north = roundCoord(parsed.north);
  } else if (parsed.kind === "antimeridian") {
    // Vue antiméridien (Pacifique) : on prend l'enveloppe mondiale pour
    // les tiers agrégats. Pour les pins (zoom ≥ 10) on délègue à /api/venues.
    west = roundCoord(parsed.west1);
    south = roundCoord(parsed.south);
    east = roundCoord(parsed.east2);
    north = roundCoord(parsed.north);
  } else {
    // global
    west = -179.9;
    south = -89.9;
    east = 179.9;
    north = 89.9;
  }

  try {
    const sb = getSupabaseAdminClient();

    let venues: ClusteredVenue[];
    let cacheControl: string;

    if (zoom >= 10) {
      // Tier 3 — Pins individuels via venues_in_bbox
      if (parsed.kind === "global") {
        const { data, error } = await sb
          .from("venue")
          .select("id, slug, name, lat, lon, family_slug, primary_sport_slug")
          .eq("is_published", true)
          .is("deleted_at", null)
          .limit(2000)
          .order("id");
        if (error) throw error;
        venues = (data ?? []).map((v) => ({
          cluster_id: null,
          count: 0,
          lat: v.lat,
          lon: v.lon,
          is_cluster: false,
          id: v.id,
          slug: v.slug,
          name: v.name,
          family_slug: v.family_slug,
          primary_sport_slug: v.primary_sport_slug,
        }));
      } else if (parsed.kind === "antimeridian") {
        // Split en 2 RPC pour l'antiméridien, puis merge
        const [r1, r2] = await Promise.all([
          sb.rpc("venues_in_bbox", {
            west: roundCoord(parsed.west1),
            south: roundCoord(parsed.south),
            east: roundCoord(parsed.east1),
            north: roundCoord(parsed.north),
            fams: fams ?? undefined,
            sport: sport ?? undefined,
            max_results: 2000,
          }),
          sb.rpc("venues_in_bbox", {
            west: roundCoord(parsed.west2),
            south: roundCoord(parsed.south),
            east: roundCoord(parsed.east2),
            north: roundCoord(parsed.north),
            fams: fams ?? undefined,
            sport: sport ?? undefined,
            max_results: 2000,
          }),
        ]);
        if (r1.error) throw r1.error;
        if (r2.error) throw r2.error;
        const seen = new Set<string>();
        const merged: ClusteredVenue[] = [];
        for (const v of [...(r1.data ?? []), ...(r2.data ?? [])] as Array<{
          id: string; slug: string; name: string; lat: number; lon: number;
          family_slug: string; primary_sport_slug: string;
        }>) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          merged.push({
            cluster_id: null, count: 0, lat: v.lat, lon: v.lon, is_cluster: false,
            id: v.id, slug: v.slug, name: v.name,
            family_slug: v.family_slug, primary_sport_slug: v.primary_sport_slug,
          });
          if (merged.length >= 2000) break;
        }
        venues = merged;
      } else {
        const { data, error } = await sb.rpc("venues_in_bbox", {
          west,
          south,
          east,
          north,
          fams: fams ?? undefined,
          sport: sport ?? undefined,
          max_results: 2000,
        });
        if (error) throw error;
        venues = ((data ?? []) as Array<{
          id: string; slug: string; name: string; lat: number; lon: number;
          family_slug: string; primary_sport_slug: string;
        }>).map((v) => ({
          cluster_id: null, count: 0, lat: v.lat, lon: v.lon, is_cluster: false,
          id: v.id, slug: v.slug, name: v.name,
          family_slug: v.family_slug, primary_sport_slug: v.primary_sport_slug,
        }));
      }
      cacheControl =
        "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";
    } else if (zoom < 6) {
      // Tier 1 — Agrégats par pays
      const { data, error } = await sb.rpc("venues_clustered_country", {
        west,
        south,
        east,
        north,
        fams: fams ?? undefined,
        sport: sport ?? undefined,
      });
      if (error) throw error;
      venues = (data ?? []) as ClusteredVenue[];
      cacheControl =
        "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
    } else {
      // Tier 2 — Grille ST_SnapToGrid (6 ≤ zoom < 10)
      const cellDeg = cellDegForZoom(zoom);
      const { data, error } = await sb.rpc("venues_clustered_grid", {
        west,
        south,
        east,
        north,
        cell_deg: cellDeg,
        fams: fams ?? undefined,
        sport: sport ?? undefined,
      });
      if (error) throw error;
      venues = (data ?? []) as ClusteredVenue[];
      cacheControl =
        "public, max-age=300, s-maxage=900, stale-while-revalidate=3600";
    }

    const tier: ClusteredResponse["tier"] =
      zoom < 6 ? "country" : zoom < 10 ? "grid" : "pins";

    return NextResponse.json(
      { venues, count: venues.length, zoom, tier } satisfies ClusteredResponse,
      { headers: { "Cache-Control": cacheControl } },
    );
  } catch (e) {
    captureException(e, { route: "/api/venues/clustered", bbox: bboxRaw, zoom });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
