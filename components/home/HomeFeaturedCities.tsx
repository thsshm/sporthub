/**
 * Section "Villes à explorer" — affiche les villes featured avec leur count
 * de venues publiées. Query directe Supabase (Server Component).
 *
 * Strategy :
 *   1. SELECT id, slug, name, country_code FROM city WHERE is_featured = true ORDER BY name ;
 *   2. Pour chaque ville, count(planned) des venues publiées non supprimées.
 *
 * Si aucune ville featured en base, on retombe sur une liste hardcodée
 * (Paris, Lyon, Marseille) — utile pendant le boot avant que l'admin n'ait
 * marqué les featured cities en DB.
 *
 * Note count=planned : sur la table venue (centaines de milliers de lignes)
 * count=exact timeout. planned est instantané, précision ±1% suffisante.
 */
import { unstable_cache } from "next/cache";
import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";

type FeaturedCity = {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  count: number;
};

/** Fallback statique si la table city ne contient pas encore de featured cities. */
const FALLBACK_CITIES: Array<Pick<FeaturedCity, "slug" | "name" | "country_code">> =
  [
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

  // 1) On tente de récupérer les featured cities en DB
  let cities: CityRow[] = [];
  try {
    const { data } = await sb
      .from("city")
      .select("id, slug, name, country_code")
      .eq("is_featured", true)
      .order("name", { ascending: true })
      .limit(6);
    cities = (data as CityRow[] | null) ?? [];
  } catch {
    cities = [];
  }

  // 2) Fallback hardcodé si rien en base — on remonte les rows correspondants
  if (cities.length === 0) {
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
  }

  // 3) Pour chaque ville on récupère le count (planned) de venues publiées
  const enriched = await Promise.all(
    cities.map(async (c) => {
      let count = 0;
      try {
        const res = await sb
          .from("venue")
          .select("id", { count: "planned", head: true })
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
    }),
  );

  // 4) On trie par count décroissant pour montrer les plus actives en premier
  return enriched.sort((a, b) => b.count - a.count);
  },
  ["home-featured-cities"],
  { revalidate: 300, tags: ["home"] },
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
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("title")}
          </h2>
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
              <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {city.country_code}
              </span>
              <span className="mt-1 truncate text-base font-semibold group-hover:underline">
                {city.name}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {t("venuesCount", { count: city.count })}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
