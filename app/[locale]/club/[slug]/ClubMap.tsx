"use client";

import dynamic from "next/dynamic";
import type { VenuePin } from "@/lib/supabase/types";
import { MapLoading } from "@/components/map/MapLoading";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => <MapLoading />,
});

type Props = {
  /** Terrains du club, affichés en pins fixes. */
  venues: VenuePin[];
  /** Centre de repli (coords du club) si les terrains n'ont pas de spread. */
  center: { lat: number; lon: number };
};

/**
 * Carte d'une fiche club : affiche UNIQUEMENT les terrains du club, en mode
 * `presetVenues` (pas de bbox-aware refetch — un club est un petit ensemble
 * fixe, contrairement à /sports/[sport] qui filtre par sport au pan/zoom).
 */
export function ClubMap({ venues, center }: Props) {
  const initial = (() => {
    if (venues.length === 0) return { lat: center.lat, lon: center.lon, zoom: 13 };
    const lats = venues.map((v) => v.lat);
    const lons = venues.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const span = Math.max(maxLat - minLat, maxLon - minLon);
    const zoom =
      span > 50 ? 2 : span > 20 ? 4 : span > 8 ? 6 : span > 3 ? 8 : span > 0.5 ? 11 : 14;
    return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2, zoom };
  })();

  return (
    <div className="relative h-[400px] w-full overflow-hidden rounded-lg border">
      <MapClient
        initialLat={initial.lat}
        initialLon={initial.lon}
        initialZoom={initial.zoom}
        presetVenues={venues}
      />
    </div>
  );
}
