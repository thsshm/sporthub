/**
 * Home Sport Hub — Server Component.
 *
 * Restitue la richesse de la V1 (sporthubmap.com/index.html) :
 *   - Hero + CTA
 *   - Grille des 13 familles (avec counts live Supabase)
 *   - "Comment ça marche" / pourquoi Sport Hub (4 engagements V1)
 *   - Top spots du moment (Google ratings)
 *   - Villes featured (counts venues)
 *   - Recherches populaires (liens programmatiques)
 *   - FAQ 8 Q/R + JSON-LD FAQPage (SEO)
 *   - Bandeau "données ouvertes"
 *
 * Toutes les sections sont des Server Components dans `components/home/*`.
 * Aucun "use client" — fetch direct Supabase via getSupabaseServerClient.
 */
import { unstable_cache } from "next/cache";
import { MapPin } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { formatCount } from "@/lib/utils";
import { HomeFAQ } from "@/components/home/HomeFAQ";
import { HomeFeaturedCities } from "@/components/home/HomeFeaturedCities";
import { HomeHowItWorks } from "@/components/home/HomeHowItWorks";
import { HomePopularSearches } from "@/components/home/HomePopularSearches";
import { HomeTopSpots } from "@/components/home/HomeTopSpots";

export const revalidate = 300; // 5 min : ISR — Vercel CDN cache + revalidation background

/**
 * Counts de venues par famille — mis en cache dans le data cache Next.js
 * (unstable_cache) ET dans le CDN Vercel (revalidate=300 sur la page).
 *
 * N'utilise PAS cookies() → la home reste statique/ISR côté Vercel.
 * Cf. issue #191 : getSupabaseServerClient() appelait cookies(), ce qui
 * forçait cache-control: private, no-store sur toute la home.
 */
const fetchFamilyCounts = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const sb = getSupabaseStaticClient();
  // count=planned (estimation via Postgres stats) au lieu de count=exact :
  // sur 200k+ venues (fitness), exact timeout (statement timeout >3s) →
  // la home affichait 0 pour fitness. planned est instantané, précision
  // ±1% suffisante pour un affichage UI.
  const entries = await Promise.all(
    FAMILIES.map(async (f) => {
      try {
        const { count } = await sb
          .from("venue")
          .select("id", { count: "planned", head: true })
          .eq("family_slug", f.slug)
          .eq("is_published", true)
          .is("deleted_at", null);
        return [f.slug, count ?? 0] as const;
      } catch {
        // Si une famille fail, on ne fait pas tout planter
        return [f.slug, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
  },
  ["home-family-counts"],
  { revalidate: 300, tags: ["home"] },
);

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tFamilies = await getTranslations("families");
  const tSports = await getTranslations("sports");

  const counts = await fetchFamilyCounts();
  const totalVenues = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/40 to-background">
        <div className="container mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            {t("heroTitle")}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground md:text-xl">
            {t("heroSubtitle")}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground">
            {t("heroDescription", { count: formatCount(totalVenues) })}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/map"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {t("ctaMap")}
            </Link>
            <Link
              href="/sports/tennis"
              className="inline-flex items-center rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              {t("ctaList")}
            </Link>
          </div>
        </div>
      </section>

      {/* Grille familles */}
      <section className="container mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("familiesTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("familiesSubtitle")}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FAMILIES.map((family) => {
            const count = counts[family.slug] ?? 0;
            const hasVenues = count > 0;
            const topSports = family.sports
              .slice(0, 4)
              .map((slug) => SPORTS_BY_SLUG[slug])
              .filter(Boolean);
            return (
              <div
                key={family.slug}
                className="flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
              >
                <div
                  className="h-1.5"
                  style={{ backgroundColor: family.color }}
                  aria-hidden="true"
                />
                <div className="flex flex-1 flex-col p-4">
                  <Link
                    href={`/sports/${family.sports[0]}`}
                    className="group flex items-center gap-3"
                  >
                    <span className="text-3xl leading-none" aria-hidden="true">
                      {family.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold leading-tight group-hover:underline">
                        {tFamilies(family.slug)}
                      </h3>
                      <p
                        className={`mt-0.5 text-xs ${hasVenues ? "text-muted-foreground" : "text-muted-foreground/60"}`}
                      >
                        {t("spotsCount", { count })}
                      </p>
                    </div>
                  </Link>

                  {hasVenues && topSports.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {topSports.map((sport) => (
                        <Link
                          key={sport.slug}
                          href={`/sports/${sport.slug}`}
                          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {sport.emoji && (
                            <span aria-hidden="true">{sport.emoji}</span>
                          )}
                          <span>{tSports(sport.slug)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Comment ça marche / pourquoi Sport Hub */}
      <HomeHowItWorks />

      {/* Top spots du moment (Google ratings) */}
      <HomeTopSpots />

      {/* Villes featured */}
      <HomeFeaturedCities />

      {/* Recherches populaires : pages programmatiques sport × ville */}
      <HomePopularSearches />

      {/* FAQ 8 Q/R + JSON-LD FAQPage */}
      <HomeFAQ />

      {/* Données ouvertes */}
      <section className="border-t bg-muted/20">
        <div className="container mx-auto max-w-4xl px-6 py-10 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dataSourcesTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("dataSourcesDescription")}
          </p>
        </div>
      </section>
    </>
  );
}
