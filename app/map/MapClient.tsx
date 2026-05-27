"use client";

import type { VenuePin } from "@/lib/supabase/types";
import { formatCount } from "@/lib/utils";

type Props = {
  venues: VenuePin[];
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  onVenueClick?: (venue: VenuePin) => void;
};

export default function MapClient({ venues }: Props) {
  return (
    <div className="flex h-full min-h-[400px] w-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
      Carte MapLibre à implémenter (issue #10) — {formatCount(venues.length)} venues à afficher
    </div>
  );
}
