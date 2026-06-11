/**
 * Section "Villes à explorer" — affiche les villes avec le plus de venues
 * publiées (Server Component).
 *
 * Strategy :
 *   1. RPC `top_cities_by_venue_count(6)` (migration 0017) : GROUP BY city
 *      ORDER BY COUNT(venue) DESC → les villes réellement les plus actives,
 *      indépendamment de is_featured (qui était curé DE/CZ et triait en "A").
 *   2. Fallback : liste hardcodée (Paris, Lyon…) + count exact par ville, si la
 *      RPC est indisponible (ex. migration pas encore appliquée) ou vide.
 *
 * count=exact (et pas "planned") : le filtre city_id est sélectif (index dédié)
 * donc COUNT(*) reste rapide par ville ; "planned" renvoyait une estimée
 * pg_stat ~constante (toutes les villes affichaient le même "19 spots").
 */
import { unstable_cache } from "next/cache";
import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { formatCityName } from "@/lib/format-city";

type FeaturedCity = {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  count: number;
};

/** Fallback statique si la table city ne contient pas encore de featured cities. */
const FALLBACK_CITIES: Array<Pick<FeaturedCity, "slug" | "name" | "country_code">> = [
  { slug: "paris", name: "Paris", country_code: "FR" },
  { slug: "lyon", name: "Lyon", country_code: "FR" },
  { slug: "marseille", name: "Marseille", country_code: "FR" },
  { slug: "bordeaux", name: "Bordeaux", country_code: "FR" },
  { slug: "nantes", name: "Nantes", country_code: "FR" },
  { slug: "toulouse", name: "Toulouse", country_code: "FR" },
];

type CityRow = {
  id: string;
  slug: string;
  name: string;
  country_code: string;
};

const fetchFeaturedCities = unstable_cache(
  async (): Promise<FeaturedCity[]> => {
    const sb = getSupabaseStaticClient();

    // 1) Voie principale : top villes par nombre de venues publiées, via la RPC
    // top_cities_by_venue_count (migration 0017). "Villes avec le plus de spots",
    // indépendant de is_featured (qui était curé DE/CZ et triait en "A").
    try {
      const { data, error } = await sb.rpc("top_cities_by_venue_count", {
        max_results: 6,
      });
      if (!error && data && data.length > 0) {
        return data.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          country_code: c.country_code,
          count: Number(c.count) || 0,
        }));
      }
    } catch {
      /* RPC indisponible (ex. migration 0017 pas encore appliquée) → fallback */
    }

    // 2) Fallback : liste hardcodée (Paris, Lyon…) + count exact par ville.
    // Utilisé tant que la RPC n'est pas en base, ou si elle ne renvoie rien.
    let cities: CityRow[] = [];
    try {
      const slugs = FALLBACK_CITIES.map((c) => c.slug);
      const { data } = await sb
        .from("city")
        .select("id, slug, name, country_code")
        .in("slug", slugs)
        .eq("country_code", "FR");
      cities = (data as CityRow[] | null) ?? [];
    } catch {
      cities = [];
    }

    const enriched = await Promise.all(
      cities.map(async (c) => {
        let count = 0;
        try {
          const res = await sb
            .from("venue")
            .select("id", { count: "exact", head: true })
            .eq("city_id", c.id)
            .eq("is_published", true)
            .is("deleted_at", null);
          count = res.count ?? 0;
        } catch {
          count = 0;
        }
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          country_code: c.country_code,
          count,
        } satisfies FeaturedCity;
      })
    );
    return enriched.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
  },
  ["home-featured-cities"],
  { revalidate: 300, tags: ["home"] }
);

export async function HomeFeaturedCities() {
  const t = await getTranslations("featuredCities");
  const cities = await fetchFeaturedCities();

  // Si aucune ville trouvée (DB vide / non seedée), on n'affiche rien
  // — la home reste valide sans cette section.
  if (cities.length === 0) return null;

  return (
    <section className="border-t bg-muted/10">
      <div className="container mx-auto max-w-6xl px-6 py-14">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("title")}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cities.map((city) => (
            <Link
              key={city.id}
              href={`/map?city=${city.slug}`}
              className="group flex flex-col rounded-lg border bg-card p-4 transition-shadow hover:shadow-md"
            >
              {/* Ville = ancre visuelle (#609) : nom en gras, normalisé (« PARIS »
                  → « Paris », #559) ; le code pays passe en suffixe discret (il
                  dominait la carte auparavant). */}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span
                  className="min-w-0 flex-1 truncate text-base font-semibold group-hover:underline"
                  title={formatCityName(city.name)}
                >
                  {formatCityName(city.name)}
                </span>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  {city.country_code}
                </span>
              </span>
              <span className="mt-1.5 text-xs text-muted-foreground">
                {t("venuesCount", { count: city.count })}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
