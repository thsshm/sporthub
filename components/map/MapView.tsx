/**
 * Wrapper MapLibre GL — Server Component shell.
 * Le rendu carte réel est dans MapClient.tsx ("use client").
 * Ce composant permet d'utiliser la carte dans des Server Components
 * sans polluer le bundle serveur avec maplibre-gl (lib client-only).
 */
import dynamic from "next/dynamic";
import type { VenuePin } from "@/lib/supabase/types";

// Import dynamique pour éviter SSR de maplibre-gl (window n'existe pas côté serveur)
const MapClient = dynamic(() => import("@/app/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/30">
      <p className="text-sm text-muted-foreground">Chargement de la carte…</p>
    </div>
  ),
});

type Props = {
  venues?: VenuePin[];
  initialLat?: number;
  initialLon?: number;
  initialZoom?: number;
  onVenueClick?: (venue: VenuePin) => void;
  className?: string;
};

export function MapView({
  venues = [],
  initialLat = 46.5,
  initialLon = 2.5,
  initialZoom = 5,
  onVenueClick,
  className,
}: Props) {
  return (
    <div className={`relative overflow-hidden rounded-lg ${className ?? ""}`}>
      <MapClient
        venues={venues}
        initialLat={initialLat}
        initialLon={initialLon}
        initialZoom={initialZoom}
        onVenueClick={onVenueClick}
      />
    </div>
  );
}
