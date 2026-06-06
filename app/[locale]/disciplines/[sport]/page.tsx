/**
 * Page /disciplines/[sport] — ranking national des clubs (#265).
 *
 * Parité V1 : /disciplines/{sport}.html listait le classement national des
 * clubs par nombre de terrains (courts_count). Ciblage SEO :
 * « meilleurs clubs de padel France », « classement clubs tennis » …
 *
 * Sports disponibles initialement : les 5 de la V1 (raquette).
 * Extensible en ajoutant des slugs à RANKED_SPORTS.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Trophy } from "lucide-react";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { getFamilyColor } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import { unstable_cache } from "next/cache";
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  buildHreflangAlternates,
  jsonLdHtml,
} from "@/lib/seo/metadata";

export const revalidate = 3600;

const SITE_URL = "https://sporthubmap.com";

/** Sports supportés sur cette page. Extensible. */
const RANKED_SPORTS = [
  "tennis",
  "padel",
  "table_tennis",
  "badminton",
  "squash",
] as const;

type RankedSport = (typeof RANKED_SPORTS)[number];

function isRankedSport(slug: string): slug is RankedSport {
  return (RANKED_SPORTS as readonly string[]).includes(slug);
}

type VenueRanking = {
  id: string;
  slug: string;
  name: string;
  courts_count: number | null;
  address: string | null;
  city_name: string | null;
  country_code: string | null;
};

const fetchRanking = unstable_cache(
  async (sportSlug: string, limit = 50): Promise<VenueRanking[]> => {
    const sb = getSupabaseStaticClient();
    try {
      // Rank par venue.courts_count DESC (colonne dénormalisée sur venue).
      // courts_count peut être NULL → mis en fin de liste (nullsFirst: false).
      // Filtre par sport via venue_sport!inner (sport_slug).
      const { data, error } = await sb
        .from("venue")
        .select(
          `id, slug, name, address, country_code, courts_count,
           city:city_id ( name ),
           venue_sport!inner ( sport_slug )`,
        )
        .eq("venue_sport.sport_slug", sportSlug)
        .eq("is_published", true)
        .is("deleted_at", null)
        .order("courts_count", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error || !data) return [];
      return (data as unknown[]).map((row) => {
        const r = row as {
          id: string; slug: string; name: string;
          address: string | null; country_code: string | null;
          courts_count: number | null;
          city: { name: string } | null;
        };
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          courts_count: r.courts_count,
          address: r.address,
          city_name: r.city?.name ?? null,
          country_code: r.country_code,
        };
      });
    } catch {
      return [];
    }
  },
  ["disciplines-ranking"],
  { revalidate: 3600, tags: ["disciplines"] },
);

type Props = {
  params: Promise<{ locale: string; sport: string }>;
};

export function generateStaticParams() {
  return RANKED_SPORTS.flatMap((sport) => [
    { sport },
  ]);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, sport: sportSlug } = await params;
  if (!isRankedSport(sportSlug)) return { title: "Not found" };
  const sport = SPORTS_BY_SLUG[sportSlug];
  if (!sport) return { title: "Not found" };
  const t = await getTranslations({ locale, namespace: "disciplines" });
  const tSports = await getTranslations({ locale, namespace: "sports" });
  const sportName = tSports.has(sportSlug) ? tSports(sportSlug) : sport.name_fr;
  const hreflang = buildHreflangAlternates(`/disciplines/${sportSlug}`);

  // #331 : tant que le ranking ne ramène rien (la requête ORDER BY courts_count
  // sur le set joint peut timeout côté DB → 0 club), la page est du thin content.
  // On la met en `noindex` pour ne pas faire indexer des pages vides par Google
  // ni envoyer « 0 clubs » aux LLMs (AEO). `follow` reste actif pour le crawl
  // interne. Auto-correcteur : dès que le ranking se remplit, la page redevient
  // indexable sans intervention. Même appel (mêmes args) que la page → cache
  // partagé, pas de requête supplémentaire.
  const isEmpty = (await fetchRanking(sportSlug, 50)).length === 0;

  return {
    title: t("metaTitle", { sport: sportName }),
    description: t("metaDescription", { sport: sportName }),
    robots: isEmpty ? { index: false, follow: true } : undefined,
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export default async function DisciplinesPage({ params }: Props) {
  const { locale, sport: sportSlug } = await params;
  setRequestLocale(locale);

  if (!isRankedSport(sportSlug)) notFound();
  const sport = SPORTS_BY_SLUG[sportSlug];
  if (!sport) notFound();

  const t = await getTranslations("disciplines");
  const tSports = await getTranslations("sports");
  const sportName = tSports.has(sportSlug) ? tSports(sportSlug) : sport.name_fr;
  const familyColor = getFamilyColor(sport.family_slug);

  const venues = await fetchRanking(sportSlug, 50);

  const itemListJsonLd = buildItemListJsonLd(
    sportName,
    venues.slice(0, 10).map((v) => ({
      name: v.name,
      url: `${SITE_URL}/venue/${v.slug}`,
    })),
  );
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "SportHub", url: SITE_URL },
    { name: t("breadcrumbDisciplines"), url: `${SITE_URL}/disciplines/${sportSlug}` },
    { name: sportName, url: `${SITE_URL}/disciplines/${sportSlug}` },
  ]);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemListJsonLd) }} />
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }} />

      {/* Hero */}
      <section className="border-b" style={{ borderTopColor: familyColor }}>
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: familyColor }}
          aria-hidden="true"
        />
        <div className="container mx-auto max-w-4xl px-6 py-12 text-center md:py-16">
          <span className="text-4xl" aria-hidden="true">{sport.emoji}</span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {t("hero", { sport: sportName })}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
            {t("heroSub", { sport: sportName, count: formatCount(venues.length) })}
          </p>
        </div>
      </section>

      {/* Podium top 3 */}
      {venues.length > 0 && (
        <section className="container mx-auto max-w-4xl px-6 py-8">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-yellow-500" aria-hidden="true" />
            {t("podiumTitle")}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {venues.slice(0, 3).map((v, i) => (
              <Link
                key={v.id}
                href={`/venue/${v.slug}`}
                className="group relative flex flex-col rounded-lg border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <span className="absolute right-3 top-3 text-2xl font-bold text-muted-foreground/30 select-none">
                  #{i + 1}
                </span>
                <p className="pr-8 text-sm font-semibold leading-tight group-hover:underline">
                  {v.name}
                </p>
                {v.city_name && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {v.city_name}{v.country_code ? ` · ${v.country_code}` : ""}
                  </p>
                )}
                {v.courts_count != null && v.courts_count > 0 && (
                  <p className="mt-2 text-xs font-medium" style={{ color: familyColor }}>
                    {t("courtsCount", { count: v.courts_count })}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Classement complet */}
      <section className="container mx-auto max-w-4xl px-6 pb-12">
        <h2 className="text-lg font-semibold">{t("rankingTitle", { sport: sportName })}</h2>

        {venues.length === 0 ? (
          <p className="mt-6 text-center text-muted-foreground">{t("noVenues")}</p>
        ) : (
          <ol className="mt-4 divide-y rounded-lg border bg-card">
            {venues.map((v, i) => (
              <li key={v.id}>
                <Link
                  href={`/venue/${v.slug}`}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <span className="w-7 shrink-0 text-right text-sm font-mono text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium group-hover:underline">
                      {v.name}
                    </p>
                    {(v.city_name || v.address) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {v.city_name ?? v.address}
                      </p>
                    )}
                  </div>
                  {v.courts_count != null && v.courts_count > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("courtsCount", { count: v.courts_count })}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        )}

        {/* CTA carte filtrée par sport */}
        <div className="mt-8 text-center">
          <Link
            href={`/map?family=${sport.family_slug}`}
            className="inline-flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: familyColor }}
          >
            {t("ctaMap", { sport: sportName })}
          </Link>
        </div>
      </section>

      {/* Navigation inter-disciplines */}
      <section className="border-t bg-muted/10">
        <div className="container mx-auto max-w-4xl px-6 py-8">
          <p className="text-sm font-semibold text-muted-foreground">{t("otherDisciplines")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {RANKED_SPORTS.filter((s) => s !== sportSlug).map((s) => {
              const sp = SPORTS_BY_SLUG[s];
              if (!sp) return null;
              const name = tSports.has(s) ? tSports(s) : sp.name_fr;
              return (
                <Link
                  key={s}
                  href={`/disciplines/${s}`}
                  className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  <span aria-hidden="true">{sp.emoji}</span>
                  {name}
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
