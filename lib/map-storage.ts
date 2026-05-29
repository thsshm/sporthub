/**
 * Helpers de persistance localStorage pour /map.
 * - Viewport (dernière position vue par l'utilisateur)
 * - Préférence autoUpdate (mise à jour auto en pan/zoom)
 *
 * Tous SSR-safe : retournent null si window indéfini.
 */

const VIEWPORT_KEY = "sporthub-map-viewport";
const AUTO_UPDATE_KEY = "sporthub-map-auto-update";
const VIEW_MODE_KEY = "sporthub-map-view-mode";

/** Mode d'affichage /map (#123). "map" = carte seule, "list" = liste seule,
 * "split" = grille 3 colonnes filtres-carte-liste (desktop ≥ 1100px). */
export type ViewMode = "map" | "list" | "split";

export function isViewMode(v: unknown): v is ViewMode {
  return v === "map" || v === "list" || v === "split";
}

export function loadViewMode(): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    return isViewMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveViewMode(mode: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* silent */
  }
}

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
