"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useState } from "react";
import Link from "next/link";
import { Map, Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import type { VenuePin } from "@/lib/supabase/types";
import { getFamilyColor, getFamilyEmoji } from "@/lib/families";

type Props = {
  venues: VenuePin[];
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  onVenueClick?: (venue: VenuePin) => void;
};

export default function MapClient({
  venues,
  initialLat,
  initialLon,
  initialZoom,
}: Props) {
  const [selected, setSelected] = useState<VenuePin | null>(null);

  return (
    <Map
      initialViewState={{
        latitude: initialLat,
        longitude: initialLon,
        zoom: initialZoom,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={{
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm-layer", type: "raster", source: "osm" }],
      }}
    >
      <NavigationControl position="top-right" />

      {venues.map((v) => (
        <Marker
          key={v.id}
          latitude={v.lat}
          longitude={v.lon}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setSelected(v);
          }}
        >
          <button
            type="button"
            aria-label={v.name}
            title={v.name}
            className="block h-3 w-3 cursor-pointer rounded-full border-2 border-white shadow-md transition-transform hover:scale-150"
            style={{ backgroundColor: getFamilyColor(v.family_slug) }}
          />
        </Marker>
      ))}

      {selected && (
        <Popup
          latitude={selected.lat}
          longitude={selected.lon}
          anchor="bottom"
          onClose={() => setSelected(null)}
          closeButton
          closeOnClick={false}
          offset={12}
          maxWidth="240px"
        >
          <div className="min-w-[180px] p-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span aria-hidden="true">{getFamilyEmoji(selected.family_slug)}</span>
              <span className="capitalize">{selected.family_slug}</span>
            </div>
            <Link
              href={`/venue/${selected.slug}`}
              className="mt-1 block text-sm font-semibold leading-tight text-gray-900 hover:underline"
            >
              {selected.name}
            </Link>
            <p className="mt-1 font-mono text-[10px] text-gray-400">
              {selected.lat.toFixed(3)}, {selected.lon.toFixed(3)}
            </p>
          </div>
        </Popup>
      )}
    </Map>
  );
}
