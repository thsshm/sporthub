/**
 * Helper de normalisation de bbox pour /api/venues.
 *
 * PostGIS `ST_MakeEnvelope` ne sait pas gérer :
 *   - une enveloppe qui touche/dépasse l'antiméridien (lon = ±180)
 *     → erreur "Antipodal (180 degrees long) edge detected!"
 *   - une enveloppe quasi-mondiale qui couvre tout le globe
 *
 * Ce helper classifie la bbox demandée par le client et retourne :
 *   - `global`        : la vue couvre (quasi) tout le monde → skip filtre spatial
 *   - `antimeridian`  : la vue franchit la ligne de date Pacifique → split en 2
 *   - `normal`        : bbox standard, clampée pour éviter de toucher ±180/±90
 *
 * Le Route Handler dispatche sur ce kind pour construire la query SQL adéquate.
 *
 * cf. issue #101.
 */

/** Lon max sûre pour ST_MakeEnvelope (évite l'erreur antipodale à exactement ±180). */
const LON_MAX = 179.9;
/** Lat max sûre — au-delà, ST_MakeEnvelope::geography peut être instable près des pôles. */
const LAT_MAX = 89.9;

/**
 * Seuil pour considérer la bbox comme "mondiale" : si la largeur en longitude
 * dépasse 350° et la hauteur dépasse 170°, on skip le filtre spatial entièrement.
 * Heuristique conservatrice — l'utilisateur a dézoomé au max.
 */
const GLOBAL_LON_THRESHOLD = 350;
const GLOBAL_LAT_THRESHOLD = 170;

export type NormalizedBbox =
  | {
      kind: "global";
    }
  | {
      kind: "normal";
      west: number;
      south: number;
      east: number;
      north: number;
    }
  | {
      kind: "antimeridian";
      /** Moitié ouest : [west, 180] */
      west1: number;
      east1: number;
      /** Moitié est : [-180, east] */
      west2: number;
      east2: number;
      south: number;
      north: number;
    };

export type BboxParseError = {
  kind: "error";
  message: string;
};

/** Clamp une valeur dans un intervalle. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse "west,south,east,north" et retourne une bbox normalisée prête pour PostGIS,
 * ou un objet d'erreur si l'input est invalide.
 *
 * Règles :
 *   - 4 nombres requis, sinon erreur.
 *   - south < north strict requis (latitudes ne wrappent pas).
 *   - west peut être > east → traversée de l'antiméridien (cas Pacifique).
 *   - Si west == east, bbox dégénérée (largeur nulle) → erreur.
 *   - Lat clampée à ±89.9 pour éviter les pôles (PostGIS::geography instable).
 *   - Lon clampée à ±179.9 sauf pour le cas antimeridian (split-géré).
 */
export function parseBbox(raw: string): NormalizedBbox | BboxParseError {
  const parts = raw.split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return { kind: "error", message: "bbox must be 4 numbers: west,south,east,north" };
  }

  const [westRaw, southRaw, eastRaw, northRaw] = parts;

  // Lat doit être strictement croissante (pas de wrap au pôle).
  if (southRaw >= northRaw) {
    return { kind: "error", message: "bbox invalid: south<north required" };
  }

  // Clamp lat dans [-89.9, 89.9] (sécurité PostGIS::geography).
  const south = clamp(southRaw, -LAT_MAX, LAT_MAX);
  const north = clamp(northRaw, -LAT_MAX, LAT_MAX);

  const lonSpan = eastRaw - westRaw;
  const latSpan = northRaw - southRaw;

  // Cas 1 : bbox quasi-mondiale → on dégage le filtre spatial.
  // Vrai si lonSpan ≥ 350 (couvre quasi tout l'équateur) ET latSpan ≥ 170
  // (couvre quasi pôle-à-pôle). C'est exactement ce que MapLibre envoie
  // sur un premier rendu très dézoomé (-180,-90,180,90).
  if (lonSpan >= GLOBAL_LON_THRESHOLD && latSpan >= GLOBAL_LAT_THRESHOLD) {
    return { kind: "global" };
  }

  // Cas 2 : antiméridien — west > east signifie "on passe par la ligne de date".
  // Ex : bbox=170,-10,-170,10 sur le Pacifique. On split en 2 enveloppes
  // [west, 180] ∪ [-180, east] que le caller fera en UNION ALL côté SQL.
  if (westRaw > eastRaw) {
    return {
      kind: "antimeridian",
      west1: clamp(westRaw, -LON_MAX, LON_MAX),
      east1: LON_MAX,
      west2: -LON_MAX,
      east2: clamp(eastRaw, -LON_MAX, LON_MAX),
      south,
      north,
    };
  }

  // Cas 3 : bbox dégénérée (largeur lon nulle).
  if (westRaw === eastRaw) {
    return { kind: "error", message: "bbox invalid: west<east required" };
  }

  // Cas 4 : bbox normale — clamp lon pour éviter d'atteindre exactement ±180
  // (ce qui déclencherait "Antipodal edge detected" côté PostGIS).
  return {
    kind: "normal",
    west: clamp(westRaw, -LON_MAX, LON_MAX),
    south,
    east: clamp(eastRaw, -LON_MAX, LON_MAX),
    north,
  };
}
