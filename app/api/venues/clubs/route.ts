import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox, type NormalizedBbox } from "@/lib/bbox";
import type { ClubPin } from "@/lib/supabase/types";

/**
 * Runtime Edge — même rationale que /api/venues (cf. #167) : suppression
 * du cold start serverless pour servir l'agrégat clubs au plus près du user.
 */
export const runtime = "edge";

/**
 * Arrondi des coords bbox à 3 décimales (~111m). Bénéfice cache HTTP edge
 * identique à /api/venues : pans micro tombent dans le même bucket.
 */
const roundCoord = (n: number) => Math.round(n * 1000) / 1000;

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
  // Service role : endpoint public en lecture seule, RLS bypass justifié
  // (même rationale que /api/venues — cf. #101). Pas de data sensible ici,
  // la table `club` a une policy SELECT publique de toute façon.
  const sb = getSupabaseAdminClient();

  // ────────────────────────────────────────────────────────────────────
  // 1. Fetch des clubs dans la bbox
  // ────────────────────────────────────────────────────────────────────
  type ClubRow = {
    id: string;
    slug: string;
    name: string;
    lat: number;
    lon: number;
    family_slug: string;
  };

  let clubRows: ClubRow[];

  if (bbox.kind === "global") {
    // Bbox mondiale : on skip le filtre spatial (cf. rationale dans
    // /api/venues — sur une vue mondiale, l'index GIST n'aide pas et un
    // statement_timeout peut tomber).
    let q = sb
      .from("club")
      .select("id, slug, name, lat, lon, family_slug");
    if (filters.fams && filters.fams.length > 0) {
      q = q.in("family_slug", filters.fams);
    }
    const { data, error } = await q.limit(filters.limit).order("id");
    if (error) throw error;
    clubRows = (data ?? []) as ClubRow[];
  } else if (bbox.kind === "antimeridian") {
    // Bbox traversant l'antiméridien : 2 requêtes [west, 180] ∪ [-180, east].
    // Solution V1 : filtre lat/lon scalaire (le client Supabase n'expose pas
    // ST_MakeEnvelope directement). Sur ~milliers de clubs c'est largement OK.
    const halves = [
      { west: bbox.west1, east: bbox.east1 },
      { west: bbox.west2, east: bbox.east2 },
    ];
    const responses = await Promise.all(
      halves.map((half) => {
        let q = sb
          .from("club")
          .select("id, slug, name, lat, lon, family_slug")
          .gte("lat", bbox.south)
          .lte("lat", bbox.north)
          .gte("lon", half.west)
          .lte("lon", half.east);
        if (filters.fams && filters.fams.length > 0) {
          q = q.in("family_slug", filters.fams);
        }
        return q.limit(filters.limit);
      }),
    );
    const seen = new Set<string>();
    const merged: ClubRow[] = [];
    for (const r of responses) {
      if (r.error) throw r.error;
      for (const row of (r.data ?? []) as ClubRow[]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
        if (merged.length >= filters.limit) break;
      }
      if (merged.length >= filters.limit) break;
    }
    clubRows = merged;
  } else {
    // Bbox normale — filtre lat/lon (Postgres exploite idx_club_geom via le
    // planner si la sélectivité est bonne, sinon fallback sur idx_club_family).
    let q = sb
      .from("club")
      .select("id, slug, name, lat, lon, family_slug")
      .gte("lat", bbox.south)
      .lte("lat", bbox.north)
      .gte("lon", roundCoord(bbox.west))
      .lte("lon", roundCoord(bbox.east));
    if (filters.fams && filters.fams.length > 0) {
      q = q.in("family_slug", filters.fams);
    }
    const { data, error } = await q.limit(filters.limit);
    if (error) throw error;
    clubRows = (data ?? []) as ClubRow[];
  }

  if (clubRows.length === 0) return [];

  // ────────────────────────────────────────────────────────────────────
  // 2. Compte des venues rattachés (1 requête groupée, pas N+1)
  // ────────────────────────────────────────────────────────────────────
  const clubIds = clubRows.map((c) => c.id);

  // Pagination explicite : PostgREST plafonne une réponse à `max-rows`
  // (1000 par défaut côté Supabase). Sans ce paging, le COUNT des courts
  // serait silencieusement tronqué sur les zones denses (ex. Paris au zoom
  // 10-15 où les clubs visibles cumulent > 1000 venues) → badge sous-compté.
  // On boucle par pages de 1000 jusqu'à épuisement.
  const PAGE = 1000;
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data: venueRows, error: venueErr } = await sb
      .from("venue")
      .select("club_id")
      .in("club_id", clubIds)
      .eq("is_published", true)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (venueErr) throw venueErr;
    const rows = (venueRows ?? []) as { club_id: string | null }[];
    for (const row of rows) {
      if (!row.club_id) continue;
      counts.set(row.club_id, (counts.get(row.club_id) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
  }

  return clubRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    family_slug: c.family_slug,
    courts_count: counts.get(c.id) ?? 0,
  }));
}
