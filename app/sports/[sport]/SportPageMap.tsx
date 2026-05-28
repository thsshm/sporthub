"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { VenuePin } from "@/lib/supabase/types";

const MapClient = dynamic(() => import("@/app/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

type Props = {
  venues: VenuePin[];
  fallbackLat?: number;
  fallbackLon?: number;
  fallbackZoom?: number;
};

/**
 * Wrapper Client qui mount MapClient en mode "presetVenues" pour une
 * page sport spécifique. Calcule la bbox + zoom auto depuis les venues
 * fournis (les 24 de la page courante).
 */
export function SportPageMap({
  venues,
  fallbackLat = 46.5,
  fallbackLon = 2.5,
  fallbackZoom = 5,
}: Props) {
  const initial = useMemo(() => {
    if (venues.length === 0) {
      return { lat: fallbackLat, lon: fallbackLon, zoom: fallbackZoom };
    }
    const lats = venues.map((v) => v.lat);
    const lons = venues.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const span = Math.max(maxLat - minLat, maxLon - minLon);
    // Zoom approximatif selon le span géographique
    const zoom =
      span > 50 ? 2 : span > 20 ? 4 : span > 8 ? 6 : span > 3 ? 8 : span > 0.5 ? 11 : 13;
    return { lat: centerLat, lon: centerLon, zoom };
  }, [venues, fallbackLat, fallbackLon, fallbackZoom]);

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
