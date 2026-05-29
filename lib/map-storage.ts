/**
 * Helpers de persistance localStorage pour /map.
 * - Viewport (dernière position vue par l'utilisateur)
 * - Préférence autoUpdate (mise à jour auto en pan/zoom)
 *
 * Tous SSR-safe : retournent null si window indéfini.
 */

const VIEWPORT_KEY = "sporthub-map-viewport";
const AUTO_UPDATE_KEY = "sporthub-map-auto-update";
const ACTIVE_FAMILY_KEY = "sporthub-map-active-family";

export type Viewport = {
  lat: number;
  lon: number;
  zoom: number;
};

function isValidViewport(v: unknown): v is Viewport {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.lat === "number" &&
    obj.lat >= -90 &&
    obj.lat <= 90 &&
    typeof obj.lon === "number" &&
    obj.lon >= -180 &&
    obj.lon <= 180 &&
    typeof obj.zoom === "number" &&
    obj.zoom >= 0 &&
    obj.zoom <= 22
  );
}

export function loadViewport(): Viewport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidViewport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveViewport(v: Viewport): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEWPORT_KEY, JSON.stringify(v));
  } catch {
    /* localStorage plein/privé → silent */
  }
}

export function loadAutoUpdate(defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(AUTO_UPDATE_KEY);
    if (raw === null) return defaultValue;
    return raw === "true";
  } catch {
    return defaultValue;
  }
}

export function saveAutoUpdate(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_UPDATE_KEY, String(value));
  } catch {
    /* silent */
  }
}

/**
 * Famille active du switcher /map. `null` = "toutes les familles".
 *
 * sessionStorage (pas localStorage) : la sélection de famille active est un
 * contexte d'exploration éphémère (cf. comportement V1 où repartir de
 * /map repartait sur "toutes"). Persistant intra-onglet mais réinitialisé
 * à la fermeture du navigateur. L'URL `?family=…` reste la source autoritaire :
 * la sessionStorage ne fait qu'un "warm restart" entre deux entrées /map sans
 * paramètre dans le même onglet.
 */
export function loadActiveFamily(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_FAMILY_KEY);
    if (!raw) return null;
    // On valide juste qu'on a un slug snake_case raisonnable — pas un objet,
    // pas une chaîne arbitraire (XSS-safe avant injection dans l'URL).
    return /^[a-z_]+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveActiveFamily(slug: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (slug === null) {
      window.sessionStorage.removeItem(ACTIVE_FAMILY_KEY);
    } else {
      window.sessionStorage.setItem(ACTIVE_FAMILY_KEY, slug);
    }
  } catch {
    /* silent */
  }
}
