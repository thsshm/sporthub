import type { Metadata } from "next";
import { MapWithSearch } from "@/app/[locale]/map/MapWithSearch";

export const metadata: Metadata = {
  title: "Carte des spots sportifs",
  description:
    "Explorez la carte mondiale des spots sportifs SportHub : tennis, padel, surf, yoga, foot, pétanque et plus de 50 disciplines.",
  alternates: { canonical: "/map" },
};

export default function MapPage() {
  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      <MapWithSearch initialLat={46.5} initialLon={2.5} initialZoom={5} />
    </div>
  );
}
