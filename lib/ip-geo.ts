/**
 * Géolocalisation approximative par IP — parsing des headers Vercel.
 *
 * Vercel injecte la géoloc edge du visiteur dans des headers sur chaque requête
 * (`x-vercel-ip-latitude`, `…-longitude`, `…-city`, `…-country`), gratuitement
 * et sans API tierce. Précision ~ville (pas la rue) — idéal pour centrer la
 * carte sur la région du visiteur SANS demander de permission navigateur.
 *
 * Cf. /api/geo (route handler) qui expose ça au client, consommé par
 * MapWithSearch pour un recentrage instantané ; la géoloc navigateur (#214)
 * raffine ensuite en position précise si l'utilisateur l'autorise.
 *
 * Logique pure (prend un accesseur de header) → testable sans Request/Vercel.
 */

export type IpGeo = {
  lat: number;
  lon: number;
  /** Ville (décodée), si Vercel l'a fournie. */
  city: string | null;
  /** Code pays ISO-2 (ex "FR"), si fourni. */
  country: string | null;
};

const HEADER_LAT = "x-vercel-ip-latitude";
const HEADER_LON = "x-vercel-ip-longitude";
const HEADER_CITY = "x-vercel-ip-city";
const HEADER_COUNTRY = "x-vercel-ip-country";

function parseCoord(raw: string | null, max: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

/**
 * Construit un `IpGeo` depuis un accesseur de header (ex `req.headers.get`).
 * Retourne `null` si la latitude/longitude est absente ou hors bornes — c'est
 * le cas en dev local (headers Vercel absents) → le client retombe alors sur
 * son comportement par défaut (viewport sauvé ou France).
 */
export function parseVercelGeo(
  getHeader: (name: string) => string | null,
): IpGeo | null {
  const lat = parseCoord(getHeader(HEADER_LAT), 90);
  const lon = parseCoord(getHeader(HEADER_LON), 180);
  if (lat === null || lon === null) return null;
  // (0,0) = "Null Island" : quasi-toujours un placeholder, pas une vraie
  // position visiteur → on l'écarte.
  if (lat === 0 && lon === 0) return null;

  const rawCity = getHeader(HEADER_CITY);
  let city: string | null = null;
  if (rawCity) {
    try {
      // Vercel URL-encode les villes à espaces/accents ("San%20Francisco").
      city = decodeURIComponent(rawCity).trim() || null;
    } catch {
      city = rawCity.trim() || null;
    }
  }

  const country = getHeader(HEADER_COUNTRY)?.trim().toUpperCase() || null;
  return { lat, lon, city, country };
}
