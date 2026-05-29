import type { Metadata } from "next";
import { MapWithSearch } from "@/app/[locale]/map/MapWithSearch";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { VenuePin } from "@/lib/supabase/types";

// Bbox d'initialisation : Europe élargie centrée sur la France.
// Permet d'afficher des pins dès le first paint (LCP), avant le bbox-aware
// fetch côté client qui s'ajustera au viewport réel.
const INITIAL_BBOX = { west: -10, south: 35, east: 20, north: 55 } as const;
const INITIAL_LIMIT = 500;

export const metadata: Metadata = {
  title: "Carte des spots sportifs",
  description:
    "Explorez la carte mondiale des spots sportifs SportHub : tennis, padel, surf, yoga, foot, pétanque et plus de 50 disciplines.",
  alternates: { canonical: "/map" },
};

// Cache ISR 60s — un revalidate trop élevé (genre 1h) bloque la propagation
// des fixes de code après un nouveau deploy (la HTML cachée référence les
// anciens chunks JS jusqu'à expiration). 60s = presque-instant après deploy,
// charge DB faible. Cf. incident #100 où le fix mettait 1h à être visible.
export const revalidate = 60;

async function fetchInitialVenues(): Promise<VenuePin[]> {
  try {
    const sb = getSupabaseServerClient();
    const { data, error } = await sb.rpc("venues_in_bbox", {
      west: INITIAL_BBOX.west,
      south: INITIAL_BBOX.south,
      east: INITIAL_BBOX.east,
      north: INITIAL_BBOX.north,
      fams: null,
      sport: null,
      max_results: INITIAL_LIMIT,
    });
    if (error) return [];
    return (data ?? []) as VenuePin[];
  } catch {
    return [];
  }
}

type MapPageProps = {
  // Next.js 14 expose les query params en prop des Server Components.
  // Ici on extrait `?family=X` pour le switcher #121 : le SSR évite
  // l'erreur "useSearchParams should be wrapped in Suspense" et garde
  // le prerender ISR actif.
  searchParams: { family?: string };
};

export default async function MapPage({ searchParams }: MapPageProps) {
  const initialVenues = await fetchInitialVenues();
  const initialFamily =
    typeof searchParams.family === "string" ? searchParams.family : null;

  return (
    <>
      {/* Preconnect aux 4 subdomains CartoCDN : permet au navigateur d'établir
          la connexion TCP+TLS en parallèle du JS bundle, donc les tiles arrivent
          aussi vite que MapLibre est prêt à les demander. Économise 100-300ms
          par tile sur connexion mobile. */}
      <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://b.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://d.basemaps.cartocdn.com" crossOrigin="" />

      <div className="relative h-[calc(100vh-4rem)] w-full">
        <MapWithSearch
          initialLat={46.5}
          initialLon={2.5}
          initialZoom={5}
          initialVenues={initialVenues}
          initialFamily={initialFamily}
        />
      </div>
    </>
  );
}
