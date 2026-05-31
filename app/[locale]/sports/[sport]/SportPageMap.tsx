"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { VenuePin } from "@/lib/supabase/types";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import { formatCount } from "@/lib/utils";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

type Props = {
  /** Slug du sport pour le filtrage côté API (mode bbox-aware) */
  sportSlug: string;
  /** Venues initiaux (les 24 de la page courante) — utilisés pour calculer
   * un bbox de départ raisonnable + affichés instantanément. */
  initialVenues: VenuePin[];
  /** Total venues du sport (pour l'overlay info). */
  totalSportVenues?: number;
  /** Reporte au parent la liste des venues visibles + le centre courant,
   * pour la liste viewport-synced (#98). */
  onVenuesData?: (venues: VenuePin[], center: { lat: number; lon: number }) => void;
  /** Cible de flyTo (clic sur un item de la liste viewport). */
  flyTarget?: FlyTarget | null;
};

/**
 * Carte avec bbox-aware fetch filtré par sport. Sur /sports/[sport].
 * Au mount, affiche les venues initiaux fournis. Dès que l'user pan/zoom,
 * refetch via /api/venues?sport=X&bbox=... pour tous les venues du sport
 * dans la nouvelle vue.
 */
export function SportPageMap({
  sportSlug,
  initialVenues,
  totalSportVenues,
  onVenuesData,
  flyTarget,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(initialVenues.length);

  // Calc initial center + zoom depuis les venues initiaux
  const initial = (() => {
    if (initialVenues.length === 0) {
      return { lat: 46.5, lon: 2.5, zoom: 5 };
    }
    const lats = initialVenues.map((v) => v.lat);
    const lons = initialVenues.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const span = Math.max(maxLat - minLat, maxLon - minLon);
    const zoom =
      span > 50 ? 2 : span > 20 ? 4 : span > 8 ? 6 : span > 3 ? 8 : span > 0.5 ? 11 : 13;
    return { lat: centerLat, lon: centerLon, zoom };
  })();

  return (
    <div className="relative h-[400px] w-full overflow-hidden rounded-lg border">
      <MapClient
        initialLat={initial.lat}
        initialLon={initial.lon}
        initialZoom={initial.zoom}
        selectedSport={sportSlug}
        onVenuesChange={setVisibleCount}
        onVenuesData={onVenuesData}
        flyTarget={flyTarget}
      />
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-background/90 px-2 py-1 text-[11px] shadow backdrop-blur">
        <span className="font-semibold">{formatCount(visibleCount)}</span> visible
        {totalSportVenues != null && (
          <>
            {" "}
            / <span>{formatCount(totalSportVenues)}</span> total
          </>
        )}
      </div>
    </div>
  );
}
