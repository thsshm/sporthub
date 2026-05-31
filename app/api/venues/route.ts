import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { parseBbox, type NormalizedBbox } from "@/lib/bbox";
import type { VenuePin } from "@/lib/supabase/types";

/**
 * Runtime Edge — supprime le cold start serverless (200-800ms aléatoires)
 * en exécutant la route au plus près du user. @supabase/supabase-js est
 * compatible Edge (fetch native). Cf. #167.
 */
export const runtime = "edge";

/**
 * Arrondi des coords bbox à 3 décimales (~111m) avant l'appel RPC. Pan
 * minimum visuel ≥ 1km au zoom max → invisible. Bénéfice : pans micro
 * tombent dans le même bucket cache HTTP edge → hit rate dramatique. Cf. #167.
 */
const roundCoord = (n: number) => Math.round(n * 1000) / 1000;


/**
 * GET /api/venues?bbox=west,south,east,north
 *   [&families=raquette,glisse]
 *   [&sport=padel]
 *   [&feat=lit,indoor,wheelchair,free,paid]
 *   [&limit=2000]
 *   [&zoom=8]
 *
 * Deux modes de retour selon le zoom (cf. issue #114) :
 *   - zoom < 10        → `{ mode: 'aggregates', cells: [...] }`
 *                        bulles de densité par pays (zoom<6) ou cellules
 *                        degré-alignées (zoom 6-9). RPC `venues_aggregates`.
 *   - zoom ≥ 10        → `{ mode: 'pois', venues: VenuePin[] }`
 *                        POI individuels via RPC `venues_in_bbox`.
 *   - zoom absent      → mode 'pois' (rétro-compat avec les callers existants
 *                        antérieurs au tier de zoom).
 *
 * Le mode est discriminé dans la réponse : le client lit `mode` pour choisir
 * la source MapLibre à hydrater (`venues-pois` vs `venues-aggregates`).
 *
 * Cache :
 *   - mode 'aggregates' : `s-maxage=3600` (les counts par pays/cellule changent
 *     lentement, ~import nocturne au plus). Bénéfice cache énorme à zoom mondial.
 *   - mode 'pois' : `s-maxage=300` (déjà en place, granularité venue individuelle).
 *
 * Gestion bbox antiméridien / global déléguée à `parseBbox` (cf. lib/bbox.ts).
 *
 * `feat` (critères) ignoré en mode aggregates — le filtrage scalaire fait
 * perdre le bénéfice du cache long. À zoom dézoomé, le user vient d'arriver
 * et n'a généralement pas appliqué de filtres feat.
 */
const KNOWN_FEAT = new Set(["lit", "indoor", "wheelchair", "free", "paid"]);

/** Seuil de bascule POI ↔ agrégats. zoom ≥ ZOOM_POI_THRESHOLD = POI individuels. */
const ZOOM_POI_THRESHOLD = 10;

type VenueQueryFilters = {
  fams: string[] | null;
  sport: string | null;
  feat: string[] | null;
  limit: number;
};

type AggregateCell = {
  lat: number;
  lon: number;
  count: number;
  country_code: string | null;
};

type ApiResponse =
  | { mode: "pois"; venues: VenuePin[]; count: number }
  | { mode: "aggregates"; cells: AggregateCell[]; count: number };

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

  const sport = searchParams.get("sport")?.trim() || null;

  const featParam = searchParams.get("feat");
  const featRaw = featParam
    ? featParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const feat = featRaw.filter((s) => KNOWN_FEAT.has(s));

  const limitRaw = parseInt(searchParams.get("limit") ?? "2000", 10);
  const limit = Math.max(1, Math.min(Number.isNaN(limitRaw) ? 2000 : limitRaw, 5000));

  // `zoom` est optionnel pour rétro-compat (callers antérieurs au tier).
  // Sans zoom, on bascule en mode 'pois' (comportement historique).
  const zoomParam = searchParams.get("zoom");
  const zoomRaw = zoomParam !== null ? parseFloat(zoomParam) : null;
  const zoom =
    zoomRaw !== null && Number.isFinite(zoomRaw) ? zoomRaw : null;

  const filters: VenueQueryFilters = {
    fams: families,
    sport,
    feat: feat.length > 0 ? feat : null,
    limit,
  };

  // Décision tier : zoom absent ou ≥ 10 = POI individuels. Sinon = agrégats.
  const wantsAggregates = zoom !== null && zoom < ZOOM_POI_THRESHOLD;

  try {
    if (wantsAggregates) {
      const cells = await fetchAggregates(parsed, Math.floor(zoom!), filters);
      const body: ApiResponse = {
        mode: "aggregates",
        cells,
        count: cells.length,
      };
      return NextResponse.json(body, {
        headers: {
          // Agrégats : cache long. Les counts par pays/cellule ne bougent qu'à
          // l'import nocturne (cron #109). 1h de cache edge libère 99% des
          // requêtes mondiales/européennes (cas dominant à zoom faible).
          //   - max-age=600       : navigateur 10 min
          //   - s-maxage=3600     : edge Vercel 1h
          //   - stale-while-revalidate=86400 : sert l'ancien pendant 24h
          "Cache-Control":
            "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    const venues = await fetchVenues(parsed, filters);
    const body: ApiResponse = {
      mode: "pois",
      venues,
      count: venues.length,
    };
    return NextResponse.json(body, {
      headers: {
        // POI individuels : cache court (les venues changent à granularité
        // unitaire via /admin/venues, on veut une fenêtre de fraîcheur courte).
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    captureException(e, {
      route: "/api/venues",
      bbox: bboxRaw,
      families,
      zoom,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Mode agrégats : appelle la RPC `venues_aggregates` (migration 0011) qui
 * retourne des bulles de densité (par pays à zoom<6, par cellule degré-alignée
 * à zoom 6-9).
 *
 * Pour les bbox antiméridien / global, on dégrade gracieusement :
 *   - global       : on appelle la RPC avec une bbox mondiale clampée.
 *   - antimeridian : on fait 2 appels et on merge — les country_code étant
 *     distincts entre Pacifique-ouest et Pacifique-est, pas de dédup nécessaire.
 */
async function fetchAggregates(
  bbox: Exclude<NormalizedBbox, { kind: "error" }>,
  zoomLevel: number,
  filters: VenueQueryFilters,
): Promise<AggregateCell[]> {
  const sb = getSupabaseAdminClient();

  if (bbox.kind === "global") {
    // Bbox mondiale : on passe ±179.9/±89.9 à la RPC (l'index GIST gère
    // 348k venues sans timeout en GROUP BY simple, vs 5000 LIMIT du mode POI).
    const { data, error } = await sb.rpc("venues_aggregates", {
      west: -179.9,
      south: -89.9,
      east: 179.9,
      north: 89.9,
      zoom_level: zoomLevel,
      fams: filters.fams,
      sport: filters.sport,
    });
    if (error) throw error;
    return ((data ?? []) as AggregateCell[]);
  }

  if (bbox.kind === "antimeridian") {
    const [r1, r2] = await Promise.all([
      sb.rpc("venues_aggregates", {
        west: bbox.west1,
        south: bbox.south,
        east: bbox.east1,
        north: bbox.north,
        zoom_level: zoomLevel,
        fams: filters.fams,
        sport: filters.sport,
      }),
      sb.rpc("venues_aggregates", {
        west: bbox.west2,
        south: bbox.south,
        east: bbox.east2,
        north: bbox.north,
        zoom_level: zoomLevel,
        fams: filters.fams,
        sport: filters.sport,
      }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    return [
      ...((r1.data ?? []) as AggregateCell[]),
      ...((r2.data ?? []) as AggregateCell[]),
    ];
  }

  const { data, error } = await sb.rpc("venues_aggregates", {
    west: bbox.west,
    south: bbox.south,
    east: bbox.east,
    north: bbox.north,
    zoom_level: zoomLevel,
    fams: filters.fams,
    sport: filters.sport,
  });
  if (error) throw error;
  return ((data ?? []) as AggregateCell[]);
}

/**
 * Mode POI individuels (comportement historique). Dispatche la requête venues
 * selon le kind de bbox normalisée. Throw en cas d'erreur Supabase.
 */
async function fetchVenues(
  bbox: Exclude<NormalizedBbox, { kind: "error" }>,
  filters: VenueQueryFilters,
): Promise<VenuePin[]> {
  // Service role (RLS bypass). /api/venues est un endpoint public en lecture
  // seule — les filtres `is_published=true AND deleted_at IS NULL` sont
  // appliqués partout en SQL, donc aucun row "privé" ne fuit. Le bypass est
  // nécessaire car la policy RLS anon cause un statement_timeout (~3s) sur
  // les régions à faible densité de venues (Atlantique, Pacifique, etc.)
  // alors que service_role n'a pas cette limite (cf. fix #101).
  const sb = getSupabaseAdminClient();

  if (bbox.kind === "global") {
    // Bbox mondiale : appeler la RPC avec spatial filter timeout sur ~348k
    // venues, même avec l'index GIST. On bypasse l'enveloppe ST_MakeEnvelope
    // et on fait un select direct avec les filtres scalaires sur les colonnes
    // indexées (family_slug, primary_sport_slug, has_lighting, etc.).
    //
    // Compromis : on ne respecte pas la sémantique des `feat` (qui exige du
    // SQL côté RPC) — mais en pratique, sur la vue mondiale, le user vient
    // d'arriver et n'a pas encore appliqué de filtres feat. C'est ok.
    let q = sb
      .from("venue")
      .select("id, slug, name, lat, lon, family_slug, primary_sport_slug")
      .eq("is_published", true)
      .is("deleted_at", null);

    if (filters.fams && filters.fams.length > 0) {
      q = q.in("family_slug", filters.fams);
    }
    if (filters.sport) {
      q = q.eq("primary_sport_slug", filters.sport);
    }
    // Mapping des feat scalaires côté colonne (subset des critères supportés).
    if (filters.feat) {
      for (const f of filters.feat) {
        if (f === "lit") q = q.eq("has_lighting", true);
        else if (f === "indoor") q = q.eq("is_indoor", true);
        else if (f === "wheelchair") q = q.eq("is_wheelchair_accessible", true);
        else if (f === "free") q = q.eq("fee_required", false);
        else if (f === "paid") q = q.eq("fee_required", true);
      }
    }

    const { data, error } = await q.limit(filters.limit).order("id");
    if (error) throw error;
    return (data ?? []) as VenuePin[];
  }

  if (bbox.kind === "antimeridian") {
    // Bbox traversant l'antiméridien : on lance 2 requêtes RPC en parallèle
    // sur les 2 moitiés [west, 180] et [-180, east], puis on dédup par id.
    // Le total est cappé au `limit` demandé (pas 2×limit).
    const [r1, r2] = await Promise.all([
      sb.rpc("venues_in_bbox", {
        west: roundCoord(bbox.west1),
        south: roundCoord(bbox.south),
        east: roundCoord(bbox.east1),
        north: roundCoord(bbox.north),
        fams: filters.fams ?? undefined,
        sport: filters.sport ?? undefined,
        feat: filters.feat ?? undefined,
        max_results: filters.limit,
      }),
      sb.rpc("venues_in_bbox", {
        west: roundCoord(bbox.west2),
        south: roundCoord(bbox.south),
        east: roundCoord(bbox.east2),
        north: roundCoord(bbox.north),
        fams: filters.fams ?? undefined,
        sport: filters.sport ?? undefined,
        feat: filters.feat ?? undefined,
        max_results: filters.limit,
      }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;

    const seen = new Set<string>();
    const merged: VenuePin[] = [];
    for (const v of [...((r1.data ?? []) as VenuePin[]), ...((r2.data ?? []) as VenuePin[])]) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      merged.push(v);
      if (merged.length >= filters.limit) break;
    }
    return merged;
  }

  // Bbox normale, valeurs déjà clampées par parseBbox.
  const { data, error } = await sb.rpc("venues_in_bbox", {
    west: roundCoord(bbox.west),
    south: roundCoord(bbox.south),
    east: roundCoord(bbox.east),
    north: roundCoord(bbox.north),
    fams: filters.fams ?? undefined,
    sport: filters.sport ?? undefined,
    feat: filters.feat ?? undefined,
    max_results: filters.limit,
  });
  if (error) throw error;
  return (data ?? []) as VenuePin[];
}
