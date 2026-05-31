/**
 * Section "Villes à explorer" — affiche les villes featured avec leur count
 * de venues publiées. Query directe Supabase (Server Component).
 *
 * Strategy :
 *   1. SELECT … FROM city WHERE is_featured = true ORDER BY population DESC LIMIT 12
 *      (pool de candidats — tri par population, PAS alphabétique).
 *   2. Pour chaque ville, count(exact) des venues publiées non supprimées.
 *   3. On garde les 6 villes avec le plus de venues → "villes avec le plus de spots".
 *
 * Si aucune ville featured en base, on retombe sur une liste hardcodée
 * (Paris, Lyon, Marseille…) — utile pendant le boot avant que l'admin n'ait
 * marqué les featured cities en DB.
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
      // Tri par population décroissante — PAS alphabétique : `ORDER BY name`
      // ne remontait que des villes en "A" quand beaucoup sont is_featured.
      // On prend un pool de 12 candidats (les plus peuplés), puis on garde les
      // 6 avec le plus de venues (étape 4) → "villes avec le plus de spots".
      .order("population", { ascending: false, nullsFirst: false })
      .limit(12);
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

  // 3) Pour chaque ville on récupère le count EXACT de venues publiées.
  // count="exact" (et pas "planned") : on filtre par city_id (index dédié),
  // donc COUNT(*) reste rapide par ville — alors que "planned" renvoyait une
  // estimée pg_stat ~constante (toutes les villes affichaient "19 spots").
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
    }),
  );

  // 4) On trie par count décroissant et on garde les 6 villes les plus actives
  // (parmi le pool de 12 candidats). Tiebreak alphabétique pour la stabilité.
  return enriched
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6);
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
