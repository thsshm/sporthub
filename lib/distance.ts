/**
 * Distance géographique + formatage lisible (#703). Pur, testable.
 * Sert à afficher « ~2,3 km » sur une card quand la position du visiteur est
 * connue (IP-geo, /api/geo). Approximatif par construction (centre-ville IP) →
 * formaté avec un « ~ » et arrondi grossier.
 */

const EARTH_R_M = 6_371_000;

/** Distance à vol d'oiseau en mètres (haversine). */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Formate une distance (mètres) en libellé court et honnête : « ~850 m »
 * (arrondi 50 m) sous 1 km, sinon « ~2,3 km » (1 décimale < 10 km, entier
 * au-delà). Séparateur décimal selon `locale`. Le « ~ » signale l'approximation
 * (IP-geo niveau ville).
 */
export function formatDistance(meters: number, locale = "fr"): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 950) {
    const m = Math.max(50, Math.round(meters / 50) * 50);
    return `~${m} m`;
  }
  const km = meters / 1000;
  const digits = km < 10 ? 1 : 0;
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(km);
  return `~${n} km`;
}
