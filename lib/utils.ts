/**
 * Helpers partagés pour l'UI.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine des classes Tailwind proprement — requis par shadcn/ui.
 * Résout les conflits (ex: "p-4 p-2" → "p-2").
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formate un nombre avec séparateur de milliers en français.
 * Ex: 267000 → "267 000"
 */
export function formatCount(n: number): string {
  return n.toLocaleString("fr-FR");
}

/**
 * Tronque un texte à maxLength caractères avec ellipse.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}

/**
 * Construit une URL Google Maps à partir de lat/lon.
 */
export function googleMapsUrl(lat: number, lon: number, name?: string): string {
  const q = name ? encodeURIComponent(name) : `${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${lat},${lon}`;
}

/**
 * Construit une URL Apple Maps.
 */
export function appleMapsUrl(lat: number, lon: number, name?: string): string {
  const q = name ? encodeURIComponent(name) : "";
  return `https://maps.apple.com/?q=${q}&ll=${lat},${lon}`;
}

/**
 * Construit une URL Waze.
 */
export function wazeUrl(lat: number, lon: number): string {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
}

/**
 * Construit un message WhatsApp share avec URL.
 */
export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}
