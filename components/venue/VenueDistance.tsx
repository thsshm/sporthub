"use client";

/**
 * Distance « ~2,3 km » sur une card quand la position du visiteur est connue
 * (#703). Client-only : rien n'est rendu côté serveur (la géoloc arrive au
 * mount) → pas de mismatch d'hydratation, et la card reste statique/ISR.
 *
 * Masqué au-delà de 100 km : l'IP-geo est au niveau VILLE, une « distance » de
 * plusieurs centaines de km (visiteur qui parcourt une ville lointaine) n'est
 * pas pertinente comme repère de proximité.
 */
import { useUserGeo } from "@/lib/use-user-geo";
import { distanceMeters, formatDistance } from "@/lib/distance";

const MAX_RELEVANT_M = 100_000;

export function VenueDistance({
  lat,
  lon,
  locale,
}: {
  lat: number;
  lon: number;
  locale?: string;
}) {
  const geo = useUserGeo();
  if (!geo) return null;
  const m = distanceMeters(geo.lat, geo.lon, lat, lon);
  if (!Number.isFinite(m) || m > MAX_RELEVANT_M) return null;
  return (
    <span className="ml-1 whitespace-nowrap text-xs opacity-60">· {formatDistance(m, locale)}</span>
  );
}
