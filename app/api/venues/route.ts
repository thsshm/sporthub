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
 *
 * Retourne les venues publiés dans la bounding box, optionnellement filtrés
 * par familles, sport, et critères universels. Utilise la RPC venues_in_bbox
 * (migration 0007) qui exploite l'index GIST PostGIS sur venue.geom.
 *
 * Gestion des bbox "exotiques" (cf. issue #101) — déléguée à `parseBbox` :
 *   - bbox mondiale (vue dézoomée par défaut MapLibre) → enveloppe clampée à
 *     ±179.9/±89.9 (évite l'erreur antipodale de ST_MakeEnvelope sur ±180).
 *   - bbox antiméridien (Pacifique, west > east) → split en 2 requêtes RPC
 *     puis dédup en mémoire.
 *   - bbox normale → clamping à ±179.9/±89.9 pour éviter l'edge antipodale.
 *
 * `feat` (critères) : valeurs reconnues = lit, indoor, wheelchair, free, paid.
 * Sémantique AND entre critères. Valeurs inconnues ignorées (no-op côté SQL).
 *
 * Limite : 5 000 venues max (cap côté DB pour éviter d'envoyer un MB+ au client).
 */
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
    const venues = await fetchVenues(parsed, filters);
    return NextResponse.json(
      { venues, count: venues.length },
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
        fams: filters.fams,
        sport: filters.sport,
        feat: filters.feat,
        max_results: filters.limit,
      }),
      sb.rpc("venues_in_bbox", {
        west: roundCoord(bbox.west2),
        south: roundCoord(bbox.south),
        east: roundCoord(bbox.east2),
        north: roundCoord(bbox.north),
        fams: filters.fams,
        sport: filters.sport,
        feat: filters.feat,
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
    fams: filters.fams,
    sport: filters.sport,
    feat: filters.feat,
    max_results: filters.limit,
  });
  if (error) throw error;
  return (data ?? []) as VenuePin[];
}
