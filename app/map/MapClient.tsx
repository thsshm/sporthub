"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Map,
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "react-map-gl/maplibre";
import { Star } from "lucide-react";
import type { VenuePin } from "@/lib/supabase/types";
import { getFamilyColor, getFamilyEmoji } from "@/lib/families";
import {
  appleMapsUrl,
  googleMapsUrl,
  wazeUrl,
  whatsappShareUrl,
} from "@/lib/utils";

const FAVORITES_KEY = "sporthub-favorites";

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistFavorites(favs: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {
    // localStorage plein ou mode privé — on ignore silencieusement
  }
}

export type FlyTarget = {
  lat: number;
  lon: number;
  zoom?: number;
  /** Token qui change à chaque demande de fly, même vers le même target.
   * Permet de re-déclencher l'effet quand l'user clique 2x la même suggestion. */
  token: number;
};

type Props = {
  venues: VenuePin[];
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  /** Optionnel : si set, MapClient appelle map.flyTo() à chaque changement de token. */
  flyTarget?: FlyTarget | null;
  onVenueClick?: (venue: VenuePin) => void;
};

export default function MapClient({
  venues,
  initialLat,
  initialLon,
  initialZoom,
  flyTarget,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Fly to target quand le token change (search bar suggestion clic)
  useEffect(() => {
    if (!flyTarget) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.flyTo({
      center: [flyTarget.lon, flyTarget.lat],
      zoom: flyTarget.zoom ?? 12,
      duration: 800,
      essential: true,
    });
  }, [flyTarget?.token, flyTarget?.lat, flyTarget?.lon, flyTarget?.zoom]);

  const toggleFavorite = (slug: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      persistFavorites(next);
      return next;
    });
  };

  return (
    <Map
      ref={mapRef}
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
          maxWidth="280px"
        >
          <div className="min-w-[220px] space-y-2 p-1">
            {/* Header : famille + bouton favori */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span aria-hidden="true">{getFamilyEmoji(selected.family_slug)}</span>
                <span className="capitalize">{selected.family_slug}</span>
              </div>
              <button
                type="button"
                onClick={() => toggleFavorite(selected.slug)}
                aria-label={
                  favorites.has(selected.slug)
                    ? "Retirer des favoris"
                    : "Ajouter aux favoris"
                }
                aria-pressed={favorites.has(selected.slug)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-yellow-500"
              >
                <Star
                  className="h-4 w-4"
                  fill={favorites.has(selected.slug) ? "currentColor" : "none"}
                  color={favorites.has(selected.slug) ? "#eab308" : "currentColor"}
                />
              </button>
            </div>

            {/* Nom + lien détail */}
            <Link
              href={`/venue/${selected.slug}`}
              className="block text-sm font-semibold leading-tight text-gray-900 hover:underline"
            >
              {selected.name}
            </Link>

            {/* Boutons Itinéraire */}
            <div className="flex flex-wrap gap-1 text-[11px]">
              <a
                href={googleMapsUrl(selected.lat, selected.lon, selected.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
                title="Itinéraire Google Maps"
              >
                📍 Google
              </a>
              <a
                href={appleMapsUrl(selected.lat, selected.lon, selected.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
                title="Itinéraire Apple Maps"
              >
                🗺️ Apple
              </a>
              <a
                href={wazeUrl(selected.lat, selected.lon)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
                title="Itinéraire Waze"
              >
                🚗 Waze
              </a>
              <a
                href={whatsappShareUrl(
                  selected.name,
                  `https://sporthubmap.com/venue/${selected.slug}`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
                title="Partager sur WhatsApp"
              >
                💬 WhatsApp
              </a>
            </div>
          </div>
        </Popup>
      )}
    </Map>
  );
}
