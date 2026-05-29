/**
 * Helper de normalisation des bbox passées en query param à /api/venues.
 *
 * Pourquoi un helper séparé : la logique combine validation, clamp aux
 * limites "safe" PostGIS, et gestion de l'antiméridien — autant la rendre
 * testable en isolation (cf. lib/bbox.test.ts).
 */

/** Limite "safe" : 179.9 / 89.9. PostGIS ST_MakeEnvelope plante avec
 * "Antipodal (180 degrees long) edge detected" si west=-180 ET east=180.
 * 179.9 préserve la précision visuelle (~11 km à l'équateur). */
export const SAFE_LON = 179.9;
export const SAFE_LAT = 89.9;

export type NormalizedBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type BboxParseResult =
  | { ok: true; bbox: NormalizedBbox }
  | { ok: false; error: string };

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/**
 * Parse + normalise une string bbox au format "west,south,east,north".
 *
 * Règles appliquées dans l'ordre :
 *   1. Doit contenir 4 nombres valides
 *   2. Latitudes : sud < nord (sinon erreur)
 *   3. Longitudes : si west > east, on interprète comme "traverse
 *      l'antiméridien" (cas Pacifique, ex. bbox Fiji/Hawaii) → on substitue
 *      par une bbox "monde entier" en longitude. Plus simple que splitter en
 *      2 RPC calls + UNION, et acceptable car l'index GIST PostGIS est rapide
 *      même sur world bbox.
 *   4. Clamp final sur [-SAFE_LON, SAFE_LON] × [-SAFE_LAT, SAFE_LAT] pour
 *      éviter l'erreur PostGIS antipodale.
 */
export function parseBboxParam(raw: string | null): BboxParseResult {
  if (!raw) {
    return { ok: false, error: "bbox=west,south,east,north required" };
  }
  const parts = raw.split(",").map(parseFloat);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return {
      ok: false,
      error: "bbox must be 4 numbers: west,south,east,north",
    };
  }
  const [west, south, east, north] = parts;

  if (south >= north) {
    return {
      ok: false,
      error: "bbox invalid: south<north required",
    };
  }

  // Antiméridien : west > east → on prend la bbox "monde entier" en longitude.
  // C'est plus tolérant qu'un split UNION (qui demanderait 2 RPC calls), et
  // pour SportHub un user qui croise l'antiméridien voit légitimement tout le
  // Pacifique.
  const crossesAntimeridian = west > east;
  const westRaw = crossesAntimeridian ? -SAFE_LON : west;
  const eastRaw = crossesAntimeridian ? SAFE_LON : east;

  return {
    ok: true,
    bbox: {
      west: clamp(westRaw, -SAFE_LON, SAFE_LON),
      east: clamp(eastRaw, -SAFE_LON, SAFE_LON),
      south: clamp(south, -SAFE_LAT, SAFE_LAT),
      north: clamp(north, -SAFE_LAT, SAFE_LAT),
    },
  };
}
