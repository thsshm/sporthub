/**
 * Dédup des « Spots similaires à proximité » (#657).
 *
 * Un même lieu réel apparaît parfois en PLUSIEURS records court-level
 * (ex. « Tennis Club de Lyon » ×2 = deux terrains du même club). La section
 * Similar les affichait en double. On supprime les doublons par NOM NORMALISÉ
 * + PROXIMITÉ géographique : deux records de même nom à ≤ `maxMeters` = même
 * lieu (on garde le premier) ; au-delà, ils sont considérés distincts (gardés,
 * la card affiche déjà leur localisation pour les différencier).
 *
 * Logique PURE (aucune I/O) → testable.
 */

/** Normalise un nom pour comparaison : sans accents/ponctuation, minuscules,
 *  espaces compactés. « Tennis Club de Lyon » == « tennis-club  DE Lyon ». */
export function normalizeVenueName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distance haversine en mètres (pas de dépendance). */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Garde un seul record par lieu réel (nom normalisé identique ET coords à
 * ≤ maxMeters). Ordre d'entrée préservé.
 */
export function dedupeRelatedVenues<
  T extends { name: string; lat: number; lon: number },
>(rows: T[], maxMeters = 250): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    const n = normalizeVenueName(r.name);
    const isDup = kept.some(
      (k) =>
        normalizeVenueName(k.name) === n &&
        haversineMeters(k.lat, k.lon, r.lat, r.lon) <= maxMeters,
    );
    if (!isDup) kept.push(r);
  }
  return kept;
}
