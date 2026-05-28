"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SlidersHorizontal, X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { SportFilters } from "@/app/map/SportFilters";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import type { VenuePin } from "@/lib/supabase/types";
import type { FlyTarget } from "@/app/map/MapClient";

const MapClient = dynamic(() => import("@/app/map/MapClient"), { ssr: false });

type Props = {
  venues: VenuePin[];
  initialLat: number;
  initialLon: number;
  initialZoom: number;
};

export function MapWithSearch({
  venues,
  initialLat,
  initialLon,
  initialZoom,
}: Props) {
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(
    () => new Set(FAMILIES.map((f) => f.slug)),
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const filteredVenues = useMemo(
    () => venues.filter((v) => selectedFamilies.has(v.family_slug)),
    [venues, selectedFamilies],
  );

  return (
    <div className="relative h-full w-full">
      {/* Sidebar desktop */}
      <SportFilters
        selected={selectedFamilies}
        onChange={setSelectedFamilies}
        className="absolute left-4 top-4 z-20 hidden max-h-[calc(100%-2rem)] w-56 overflow-auto md:flex"
      />

      {/* Bouton filtres mobile */}
      <button
        type="button"
        onClick={() => setMobileFiltersOpen(true)}
        aria-label="Ouvrir les filtres"
        className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-sm shadow-md backdrop-blur md:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filtres
      </button>

      {/* Drawer filtres mobile */}
      {mobileFiltersOpen && (
        <div className="absolute inset-0 z-30 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Filtres familles</span>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Fermer les filtres"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <SportFilters
                selected={selectedFamilies}
                onChange={setSelectedFamilies}
                className="border-0 p-0 shadow-none"
              />
            </div>
          </div>
        </div>
      )}

      <SearchBar
        onSelect={(r) =>
          setFlyTarget({ lat: r.lat, lon: r.lon, zoom: 12, token: Date.now() })
        }
        className="absolute right-4 top-4 z-20 w-[min(320px,calc(100vw-180px))] md:w-80"
      />

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-background/90 px-3 py-2 text-sm shadow-md backdrop-blur md:left-64">
        <span className="font-semibold">{formatCount(filteredVenues.length)}</span>{" "}
        / {formatCount(venues.length)} spots
      </div>

      <MapClient
        venues={filteredVenues}
        initialLat={initialLat}
        initialLon={initialLon}
        initialZoom={initialZoom}
        flyTarget={flyTarget}
      />
    </div>
  );
}
