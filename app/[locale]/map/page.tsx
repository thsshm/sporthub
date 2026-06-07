import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { MapWithSearch } from "@/app/[locale]/map/MapWithSearch";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isViewMode, type ViewMode } from "@/lib/map-storage";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import type { VenuePin } from "@/lib/supabase/types";
import { buildHreflangAlternates } from "@/lib/seo/metadata";
import { parseVercelGeo } from "@/lib/ip-geo";

// Bbox d'initialisation : Europe élargie centrée sur la France.
// Permet d'afficher des pins dès le first paint (LCP), avant le bbox-aware
// fetch côté client qui s'ajustera au viewport réel.
const INITIAL_BBOX = { west: -10, south: 35, east: 20, north: 55 } as const;
const INITIAL_LIMIT = 500;

// hreflang : /map est servi en FR (canonique), /en/map en EN, /zh/map en ZH.
// Sans `languages`, Google indexait uniquement /map en FR (cf. #108).
// Le canonical reste STRICTEMENT "/map" (sans query) : les variantes
// ?family= ne sont que des filtres, pas des URLs canoniques distinctes (#132,
// évite le duplicate content que /explore créait en V1).
const mapHreflang = buildHreflangAlternates("/map");

/** Parse `?family=raquette,ballon` → slugs valides, dédupliqués. Cf. #132. */
function parseFamilies(raw: string | undefined): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const slug = part.trim();
    if (slug && FAMILIES_BY_SLUG[slug]) seen.add(slug);
  }
  return Array.from(seen);
}

// Metadata adaptative selon les query params (#132) :
//   - 1 famille → "Carte des clubs de {famille}" (intention SEO famille)
//   - 0 ou multi → titre générique "explorer tous les sports"
// Localisé via next-intl pour rester cohérent avec /en/map et /zh/map (#108).
export async function generateMetadata({ params, searchParams }: MapPageProps): Promise<Metadata> {
  const { locale } = await params;
  const tMap = await getTranslations({ locale, namespace: "map" });
  const tFamilies = await getTranslations({ locale, namespace: "families" });
  const families = parseFamilies(searchParams.family);
  const single = families.length === 1 ? FAMILIES_BY_SLUG[families[0]] : null;
  const familyLabel = single ? tFamilies(single.slug) : null;
  return {
    title: familyLabel ? tMap("titleSingleFamily", { family: familyLabel }) : tMap("title"),
    description: familyLabel
      ? tMap("descSingleFamily", { family: familyLabel.toLowerCase() })
      : tMap("descGeneric"),
    alternates: {
      canonical: mapHreflang.canonical,
      languages: mapHreflang.languages,
    },
  };
}

// Cache ISR 60s — un revalidate trop élevé (genre 1h) bloque la propagation
// des fixes de code après un nouveau deploy (la HTML cachée référence les
// anciens chunks JS jusqu'à expiration). 60s = presque-instant après deploy,
// charge DB faible. Cf. incident #100 où le fix mettait 1h à être visible.
export const revalidate = 60;

/** Résout `?city=<slug>` → coords de la ville (table `city`, slug UNIQUE) pour
 * centrer la carte côté Server. Les cartes "Villes à explorer" de la home lient
 * vers /map?city=<slug> — sans ça, le param était ignoré et la carte restait en
 * vue France (agrégats), sans recentrage. Renvoie null si slug inconnu. */
async function fetchCityCenter(
  slug: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const sb = getSupabaseServerClient();
    const { data } = await sb
      .from("city")
      .select("lat, lon")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();
    if (data && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
      return { lat: data.lat, lon: data.lon };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchInitialVenues(): Promise<VenuePin[]> {
  try {
    const sb = getSupabaseServerClient();
    const { data, error } = await sb.rpc("venues_in_bbox", {
      west: INITIAL_BBOX.west,
      south: INITIAL_BBOX.south,
      east: INITIAL_BBOX.east,
      north: INITIAL_BBOX.north,
      fams: undefined,
      sport: undefined,
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
  // On extrait :
  //   ?family=X[,Y,…] → familles filtrées (1 = mode famille, multi = explore) #121/#132
  //   ?view=X         → mode d'affichage #123 (map / list / split)
  //   ?q=ville        → recentrage initial sur une ville (picker explore) #132
  //   ?city=slug      → recentrage sur une ville par slug (liens home, résolu DB)
  // Lecture côté Server pour éviter "useSearchParams should be wrapped in
  // Suspense" qui casserait le prerender ISR.
  // `params` est typé Promise (Next.js 15 pattern, cf. /favoris) pour
  // permettre l'await de la locale dans generateMetadata async.
  params: Promise<{ locale: string }>;
  searchParams: { family?: string; view?: string; q?: string; city?: string; lat?: string };
};

export default async function MapPage({ searchParams }: MapPageProps) {
  const initialFamilies = parseFamilies(searchParams.family);
  const initialViewMode: ViewMode | null = isViewMode(searchParams.view) ? searchParams.view : null;
  const initialQuery =
    typeof searchParams.q === "string" && searchParams.q.trim() ? searchParams.q.trim() : null;
  const citySlug =
    typeof searchParams.city === "string" && searchParams.city.trim()
      ? searchParams.city.trim()
      : null;
  // Géoloc IP (#409) : centrer sur la ville du visiteur au 1er chargement.
  // parseVercelGeo lit les headers Vercel edge (x-vercel-ip-latitude/longitude)
  // injectés gratuitement — retourne null en dev local (headers absents).
  // On s'en sert uniquement si aucun deep-link positionnel n'est présent
  // (pas de ?city, pas de ?lat&lon = l'utilisateur a une intention explicite).
  const h = await headers();
  const ipGeo = (!citySlug && !searchParams.lat)
    ? parseVercelGeo((name) => h.get(name))
    : null;

  // Résolution ville et venues SSR en parallèle.
  const [initialCityCenter, initialVenues] = await Promise.all([
    citySlug ? fetchCityCenter(citySlug) : Promise.resolve(null),
    fetchInitialVenues(),
  ]);

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
          initialLat={ipGeo?.lat ?? 46.5}
          initialLon={ipGeo?.lon ?? 2.5}
          initialZoom={ipGeo ? 12 : 6}
          initialVenues={initialVenues}
          initialFamilies={initialFamilies}
          initialViewMode={initialViewMode}
          initialQuery={initialQuery}
          initialCityCenter={initialCityCenter}
        />
      </div>
    </>
  );
}
