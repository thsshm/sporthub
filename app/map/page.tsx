import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MapWithSearch } from "@/app/map/MapWithSearch";
import type { VenuePin } from "@/lib/supabase/types";

const MAP_LIMIT = 1000;

export const metadata: Metadata = {
  title: "Carte des spots sportifs",
  description:
    "Explorez la carte mondiale des spots sportifs SportHub : tennis, padel, surf, yoga, foot, pétanque et plus de 50 disciplines.",
  alternates: { canonical: "/map" },
};

export const revalidate = 3600;

async function fetchVenuePins(): Promise<VenuePin[]> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("venue")
    .select("id, slug, name, lat, lon, family_slug, primary_sport_slug")
    .eq("is_published", true)
    .is("deleted_at", null)
    .limit(MAP_LIMIT);
  return (data ?? []) as VenuePin[];
}

export default async function MapPage() {
  const venues = await fetchVenuePins();

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      <MapWithSearch
        venues={venues}
        initialLat={46.5}
        initialLon={2.5}
        initialZoom={5}
      />
    </div>
  );
}
