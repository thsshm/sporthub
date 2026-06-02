import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { MapPin } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  buildHreflangAlternates,
  jsonLdHtml,
} from "@/lib/seo/metadata";
import { routing } from "@/i18n/routing";

/**
 * Hub régional « Explorer par ville » (issue #264, parité V1 /villes).
 *
 * Liste les villes avec le plus de spots indexés (RPC top_cities_by_venue_count,
 * migration 0017 — mêmes counts exacts que la section home, cf. piège #255 :
 * jamais de count "planned" qui renvoie une estimée pg_stat constante).
 *
 * SEO : page statique ISR + ItemList/BreadcrumbList JSON-LD. Chaque ville pointe
 * vers /map?city=<slug> (carte filtrée). CTA de repli vers la carte mondiale.
 */
export const revalidate = 3600;

const SITE_URL = "https://sporthubmap.com";
const MAX_CITIES = 48;

type CityRow = {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  count: number;
};

/**
 * Fallback statique si la RPC top_cities_by_venue_count est indisponible ou
 * trop lente (cf. timeout 57014 observé en prod, migration 0029). Mêmes villes
 * que la section home (HomeFeaturedCities) → page jamais blanche. Le count est
 * recalculé exact par ville (pas d'estimée pg_stat, cf. piège #255).
 */
const FALLBACK_CITIES: Array<Pick<CityRow, "slug" | "name" | "country_code">> = [
  { slug: "paris", name: "Paris", country_code: "FR" },
  { slug: "lyon", name: "Lyon", country_code: "FR" },
  { slug: "marseille", name: "Marseille", country_code: "FR" },
  { slug: "bordeaux", name: "Bordeaux", country_code: "FR" },
  { slug: "nantes", name: "Nantes", country_code: "FR" },
  { slug: "toulouse", name: "Toulouse", country_code: "FR" },
];

async function fetchFallbackCities(
  sb: ReturnType<typeof getSupabaseStaticClient>
): Promise<CityRow[]> {
  let cities: Array<Pick<CityRow, "id" | "slug" | "name" | "country_code">> = [];
  try {
    const { data } = await sb
      .from("city")
      .select("id, slug, name, country_code")
      .in(
        "slug",
        FALLBACK_CITIES.map((c) => c.slug)
      )
      .eq("country_code", "FR");
    cities = data ?? [];
  } catch {
    return [];
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
      return { ...c, count } satisfies CityRow;
    })
  );
  return enriched.sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}

const fetchTopCities = unstable_cache(
  async (): Promise<CityRow[]> => {
    const sb = getSupabaseStaticClient();
    try {
      const { data, error } = await sb.rpc("top_cities_by_venue_count", {
        max_results: MAX_CITIES,
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
      /* RPC indisponible/timeout → fallback ci-dessous */
    }
    // Repli : la page ne doit jamais être blanche (cf. /villes vide en prod).
    return fetchFallbackCities(sb);
  },
  ["villes-top-cities"],
  { revalidate: 3600, tags: ["cities"] }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cities" });
  const cities = await fetchTopCities();
  return {
    title: t("metaTitle"),
    description: t("metaDescription", { count: cities.length }),
    alternates: buildHreflangAlternates("/villes"),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function VillesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cities");
  const cities = await fetchTopCities();

  // JSON-LD : breadcrumb + liste des villes (rich results carousel possible).
  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: t("breadcrumbHome"), url: `${SITE_URL}${localePrefix || "/"}` },
    { name: t("breadcrumbCities"), url: `${SITE_URL}${localePrefix}/villes` },
  ]);
  const itemListJsonLd = buildItemListJsonLd(
    t("title"),
    cities.map((c) => ({
      name: c.name,
      url: `${SITE_URL}${localePrefix}/map?city=${c.slug}`,
    }))
  );

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemListJsonLd) }}
      />

      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
      </header>

      {cities.length > 0 ? (
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
              <span
                className="mt-1 truncate text-base font-semibold group-hover:underline"
                title={city.name}
              >
                {city.name}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {t("venuesCount", { count: city.count })}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      <section className="mt-14 rounded-lg border bg-muted/20 p-8 text-center">
        <h2 className="text-lg font-semibold">{t("notListedTitle")}</h2>
        <Link
          href="/map"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          {t("notListedCta")} <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
}
