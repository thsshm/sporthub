"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { SearchBar } from "@/components/SearchBar";
import type { VenuePin } from "@/lib/supabase/types";
import { formatCount } from "@/lib/utils";

const MapClient = dynamic(() => import("@/app/map/MapClient"), { ssr: false });

type Props = {
  venues: VenuePin[];
  initialLat: number;
  initialLon: number;
  initialZoom: number;
};

/**
 * Wrapper Client qui lie SearchBar et MapClient.
 * Au clic sur une suggestion ville, on remonte le composant Map avec une
 * nouvelle initialViewState (via `key` qui force remount) — c'est une
 * solution MVP. Pour un fly-to fluide on passera par un mapRef +
 * useImperativeHandle dans une issue dédiée.
 */
export function MapWithSearch({
  venues,
  initialLat,
  initialLon,
  initialZoom,
}: Props) {
  const [view, setView] = useState({
    lat: initialLat,
    lon: initialLon,
    zoom: initialZoom,
  });

  return (
    <div className="relative h-full w-full">
      <SearchBar
        onSelect={(r) => setView({ lat: r.lat, lon: r.lon, zoom: 12 })}
        className="absolute left-4 top-4 z-20 w-[min(380px,calc(100vw-32px))]"
      />

      <div
        className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-md bg-background/90 px-3 py-2 text-sm shadow-md backdrop-blur"
      >
        <span className="font-semibold">{formatCount(venues.length)}</span>{" "}
        spots
      </div>

      <MapClient
        key={`${view.lat.toFixed(4)},${view.lon.toFixed(4)},${view.zoom}`}
        venues={venues}
        initialLat={view.lat}
        initialLon={view.lon}
        initialZoom={view.zoom}
      />
    </div>
  );
}
