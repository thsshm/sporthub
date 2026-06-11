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
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { FAMILIES } from "@/lib/families";
import { getFamilyCounts } from "@/lib/home-stats";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeFAQ } from "@/components/home/HomeFAQ";
import { HomeFeaturedCities } from "@/components/home/HomeFeaturedCities";
import { HomeHowItWorks } from "@/components/home/HomeHowItWorks";
import { HomePopularSearches } from "@/components/home/HomePopularSearches";
import { HomeTopSpots } from "@/components/home/HomeTopSpots";

export const revalidate = 300; // 5 min : ISR — Vercel CDN cache + revalidation background

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

  const counts = await getFamilyCounts();
  const totalVenues = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* Hero — A/B home_layout (brochure | map-first), #253 */}
      <HomeHero totalSpots={totalVenues} />

      {/* Grille familles */}
      <section id="families" className="container mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("familiesTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("familiesSubtitle")}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FAMILIES.map((family) => {
            const count = counts[family.slug] ?? 0;
            // Seuil "data significative" : sous 10 venues on traite la famille
            // comme "à venir" pour ne pas afficher "1 spot" qui décrédibilise
            // (cas Board sports / Winter sports / Retreats qui ont 1 venue
            // seed chacune). Cf. audit UX V2 du 31/05.
            const MIN_MEANINGFUL_COUNT = 10;
            const hasVenues = count >= MIN_MEANINGFUL_COUNT;
            const displayCount = hasVenues ? count : 0;
            const topSports = family.sports
              .slice(0, 4)
              .map((slug) => SPORTS_BY_SLUG[slug])
              .filter(Boolean);
            // En-tête de carte (emoji + nom + compteur). Le `group-hover:underline`
            // est un no-op hors d'un ancêtre `.group` (cas non-cliquable ci-dessous).
            const familyHead = (
              <>
                <span className="text-3xl leading-none" aria-hidden="true">
                  {family.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold leading-tight group-hover:underline" title={tFamilies(family.slug)}>
                    {tFamilies(family.slug)}
                  </h3>
                  <p
                    className={`mt-0.5 text-xs ${hasVenues ? "text-muted-foreground" : "text-muted-foreground/60"}`}
                  >
                    {t("spotsCount", { count: displayCount })}
                  </p>
                </div>
              </>
            );
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
                  {/* Cliquable seulement si data significative ; sinon "coming
                      soon" non-cliquable → ne pas mener vers une page /sports
                      quasi vide depuis la home (#470). */}
                  {hasVenues ? (
                    <Link
                      href={`/sports/${family.sports[0]}`}
                      className="group flex items-center gap-3"
                    >
                      {familyHead}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3">{familyHead}</div>
                  )}

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
