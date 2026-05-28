"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Map,
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "react-map-gl/maplibre";
import Supercluster from "supercluster";
import type { ClusterFeature, PointFeature } from "supercluster";
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
    /* localStorage plein/privé → silent */
  }
}

type Bounds = [number, number, number, number]; // [west, south, east, north]
type PointProps = { venue: VenuePin };

export type FlyTarget = {
  lat: number;
  lon: number;
  zoom?: number;
  /** Token (timestamp) qui change à chaque demande, re-déclenche l'effet
   * même si le user clique 2× la même suggestion (sinon le state inchangé
   * ne re-trigger pas le useEffect). */
  token: number;
};

type Props = {
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  /** Familles cochées. Si toutes ou vide, on n'envoie pas le param families au backend. */
  selectedFamilies?: Set<string>;
  totalFamilies?: number;
  /** Callback pour reporter le count de venues fetched (overlay UI parent). */
  onVenuesChange?: (count: number) => void;
  /** Quand set, MapClient appelle map.flyTo() à chaque changement de token. */
  flyTarget?: FlyTarget | null;
  /** Mode "venues fixes" : si fourni, MapClient utilise ces venues directement
   * et skip l'API bbox-aware fetch. Utile pour /sports/[sport] qui veut
   * afficher seulement la page courante. */
  presetVenues?: VenuePin[];
  /** Filtre sport pour le bbox-aware fetch. Quand set, appelle /api/venues?sport=... */
  selectedSport?: string | null;
  /** Venues SSR pré-fetched (bbox d'initialisation). Affichés immédiatement
   * pour améliorer le LCP, avant que le premier bbox-aware fetch client retourne. */
  initialVenues?: VenuePin[];
  /** Critères universels cochés (lit / indoor / wheelchair / free / paid).
   * Envoyés à /api/venues?feat=... — AND entre critères côté DB. */
  selectedCriteria?: Set<string>;
};

export default function MapClient({
  initialLat,
  initialLon,
  initialZoom,
  selectedFamilies,
  totalFamilies,
  onVenuesChange,
  flyTarget,
  presetVenues,
  selectedSport,
  initialVenues,
  selectedCriteria,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [fetchedVenues, setFetchedVenues] = useState<VenuePin[]>(
    () => initialVenues ?? [],
  );
  const venues = presetVenues ?? fetchedVenues;
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [zoom, setZoom] = useState<number>(initialZoom);
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Reporte le count initial (SSR pre-fetch) au parent pour l'overlay UI.
  useEffect(() => {
    if (initialVenues && initialVenues.length > 0) {
      onVenuesChange?.(initialVenues.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to target quand le token change (clic suggestion SearchBar)
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

  // Fetch venues debounced quand bbox ou filtres changent.
  // Skip si on est en mode presetVenues (venues fixes passées en prop).
  useEffect(() => {
    if (presetVenues) {
      onVenuesChange?.(presetVenues.length);
      return;
    }
    if (!bounds) return;
    setLoading(true);
    const handle = setTimeout(async () => {
      const params = new URLSearchParams({ bbox: bounds.join(",") });
      if (
        selectedFamilies &&
        totalFamilies &&
        selectedFamilies.size > 0 &&
        selectedFamilies.size < totalFamilies
      ) {
        params.set("families", Array.from(selectedFamilies).join(","));
      }
      if (selectedSport) {
        params.set("sport", selectedSport);
      }
      if (selectedCriteria && selectedCriteria.size > 0) {
        params.set("feat", Array.from(selectedCriteria).join(","));
      }
      try {
        const res = await fetch(`/api/venues?${params}`);
        if (!res.ok) {
          setFetchedVenues([]);
          onVenuesChange?.(0);
          return;
        }
        const data = (await res.json()) as { venues: VenuePin[] };
        setFetchedVenues(data.venues);
        onVenuesChange?.(data.venues.length);
      } catch {
        setFetchedVenues([]);
        onVenuesChange?.(0);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [bounds, selectedFamilies, totalFamilies, onVenuesChange, presetVenues, selectedSport, selectedCriteria]);

  // Supercluster index
  const supercluster = useMemo(() => {
    const sc = new Supercluster<PointProps>({ radius: 60, maxZoom: 16 });
    sc.load(
      venues.map((v) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        properties: { venue: v },
      })),
    );
    return sc;
  }, [venues]);

  const clusters = useMemo(() => {
    if (!bounds) return [];
    return supercluster.getClusters(bounds, Math.floor(zoom));
  }, [supercluster, bounds, zoom]);

  // Sync bounds + zoom à chaque interaction
  const updateViewport = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const b = map.getBounds();
    setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    setZoom(map.getZoom());
  };

  // Empty filter (l'user a tout décoché) — pas la peine de fetch
  const emptyFilter =
    selectedFamilies !== undefined && selectedFamilies.size === 0;

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
      onLoad={updateViewport}
      onMoveEnd={updateViewport}
    >
      <NavigationControl position="top-right" />

      {!emptyFilter &&
        clusters.map((feature) => {
          const [lon, lat] = feature.geometry.coordinates;

          // Cluster bubble (count)
          if ("cluster" in feature.properties && feature.properties.cluster) {
            const cf = feature as ClusterFeature<PointProps>;
            const count = cf.properties.point_count;
            const size = Math.min(60, 20 + Math.log2(count) * 8);
            return (
              <Marker
                key={`cluster-${cf.id}`}
                latitude={lat}
                longitude={lon}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  const expansionZoom = Math.min(
                    supercluster.getClusterExpansionZoom(Number(cf.id)),
                    18,
                  );
                  mapRef.current?.getMap().flyTo({
                    center: [lon, lat],
                    zoom: expansionZoom,
                    duration: 500,
                  });
                }}
              >
                <button
                  type="button"
                  aria-label={`${count} spots — zoomer`}
                  className="flex cursor-pointer items-center justify-center rounded-full border-2 border-white bg-primary/90 font-semibold text-white shadow-md transition-transform hover:scale-110"
                  style={{ width: size, height: size, fontSize: size > 36 ? 14 : 12 }}
                >
                  {count}
                </button>
              </Marker>
            );
          }

          // Pin individuel
          const pf = feature as PointFeature<PointProps>;
          const v = pf.properties.venue;
          return (
            <Marker
              key={v.id}
              latitude={lat}
              longitude={lon}
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
          );
        })}

      {loading && (
        <div className="pointer-events-none absolute right-4 top-20 z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          chargement…
        </div>
      )}

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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span aria-hidden="true">{getFamilyEmoji(selected.family_slug)}</span>
                <span className="capitalize">{selected.family_slug}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFavorites((prev) => {
                    const next = new Set(prev);
                    if (next.has(selected.slug)) next.delete(selected.slug);
                    else next.add(selected.slug);
                    persistFavorites(next);
                    return next;
                  })
                }
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

            <Link
              href={`/venue/${selected.slug}`}
              className="block text-sm font-semibold leading-tight text-gray-900 hover:underline"
            >
              {selected.name}
            </Link>

            <div className="flex flex-wrap gap-1 text-[11px]">
              <a
                href={googleMapsUrl(selected.lat, selected.lon, selected.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
              >
                📍 Google
              </a>
              <a
                href={appleMapsUrl(selected.lat, selected.lon, selected.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
              >
                🗺️ Apple
              </a>
              <a
                href={wazeUrl(selected.lat, selected.lon)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-200 px-2 py-1 text-gray-700 hover:bg-gray-50"
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
