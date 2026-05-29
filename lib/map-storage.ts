/**
 * Helpers de persistance localStorage pour /map.
 * - Viewport (dernière position vue par l'utilisateur)
 * - Préférence autoUpdate (mise à jour auto en pan/zoom)
 * - Mode d'affichage (carte / liste / split) — cf. #123
 *
 * Tous SSR-safe : retournent null si window indéfini.
 */

const VIEWPORT_KEY = "sporthub-map-viewport";
const AUTO_UPDATE_KEY = "sporthub-map-auto-update";
const VIEW_MODE_KEY = "sporthub_view_mode";

export type Viewport = {
  lat: number;
  lon: number;
  zoom: number;
};

/** Mode d'affichage de /map. Cf. #123.
 * - `map`   : carte plein écran (mode par défaut)
 * - `list`  : liste plein écran, carte cachée
 * - `split` : 3 colonnes desktop (filtres | carte | liste). Sur mobile (<1100px)
 *   on retombe automatiquement en `map` côté UI, mais la valeur `split` reste
 *   persistée pour retrouver le mode au redimensionnement. */
export type ViewMode = "map" | "list" | "split";

export const VIEW_MODES: readonly ViewMode[] = ["map", "list", "split"] as const;

export function isViewMode(v: unknown): v is ViewMode {
  return v === "map" || v === "list" || v === "split";
}

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

/** Charge le mode d'affichage de /map persisté. Retourne null si absent
 * ou valeur invalide — l'appelant décide du fallback (typiquement "map"). */
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
