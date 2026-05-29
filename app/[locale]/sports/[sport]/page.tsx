import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { SportVenuesSection } from "./SportVenuesSection";
import type { VenuePin } from "@/lib/supabase/types";
import {
  buildBreadcrumbJsonLd,
  buildItemListJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

const PAGE_SIZE = 24;

type Props = {
  params: { locale: string; sport: string };
  searchParams: { page?: string };
};

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; sport: string }>;
}): Promise<Metadata> {
  const { locale, sport: sportSlug } = await params;
  const sport = SPORTS_BY_SLUG[sportSlug];
  if (!sport) {
    const t = await getTranslations({ locale, namespace: "venue" });
    return { title: t("notFoundTitle") };
  }
  const tSports = await getTranslations({ locale, namespace: "sports" });
  const tSport = await getTranslations({ locale, namespace: "sport" });
  const name = tSports.has(sportSlug) ? tSports(sportSlug) : sport.name_fr;
  return {
    title: name,
    description: tSport("metaDescription", { sport: name }),
  };
}

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  family_slug: string;
  primary_sport_slug: string | null;
  address: string | null;
  courts_count: number | null;
  country_code: string | null;
  city?: { name?: string; country_code?: string } | null;
  venue_sport?: { sport_slug: string }[];
};

async function fetchVenues(sportSlug: string, page: number) {
  const sb = getSupabaseServerClient();
  const offset = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await sb
    .from("venue")
    .select(
      `
      id, slug, name, lat, lon, family_slug, primary_sport_slug, address,
      courts_count, country_code,
      city:city_id ( name, country_code ),
      venue_sport!inner ( sport_slug )
    `,
      { count: "planned" },
    )
    .eq("venue_sport.sport_slug", sportSlug)
    .eq("is_published", true)
    .is("deleted_at", null)
    .range(offset, offset + PAGE_SIZE - 1)
    .order("id", { ascending: true });

  if (error) return { venues: [], total: 0 };

  const venues = ((data as VenueRow[]) ?? []).map((v) => ({
    ...v,
    city_name: v.city?.name,
    country_code: v.country_code ?? v.city?.country_code ?? undefined,
    sport_slugs: v.venue_sport?.map((vs) => vs.sport_slug) ?? [],
  }));
  return { venues, total: count ?? 0 };
}

export default async function SportPage({ params, searchParams }: Props) {
  const { locale, sport: sportSlug } = (await Promise.resolve(params)) as {
    locale: string;
    sport: string;
  };
  setRequestLocale(locale);

  const sport = SPORTS_BY_SLUG[sportSlug];
  if (!sport) notFound();

  const t = await getTranslations("sport");
  const tFamilies = await getTranslations("families");
  const tSports = await getTranslations("sports");

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const { venues, total } = await fetchVenues(sportSlug, page);
  const family = FAMILIES_BY_SLUG[sport.family_slug];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sportName = tSports.has(sport.slug) ? tSports(sport.slug) : sport.name_fr;

  // ── Schema.org JSON-LD : BreadcrumbList + ItemList des venues affichés.
  //    Permet à Google de comprendre la hiérarchie (Home → Sport → Venues)
  //    et de générer des rich results de type carousel pour la liste.
  const SITE_URL = "https://sporthubmap.com";
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Sport Hub", url: SITE_URL },
    {
      name: sportName,
      url: `${SITE_URL}/${locale}/sports/${sport.slug}`,
    },
  ]);
  const itemListJsonLd = buildItemListJsonLd(
    sportName,
    venues.map((v) => ({
      name: v.name,
      url: `${SITE_URL}/${locale}/venue/${v.slug}`,
    })),
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
      <header className="border-b pb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Sport Hub
          </Link>
          <span aria-hidden="true">/</span>
          <span>{tFamilies(sport.family_slug)}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{sport.emoji || family?.emoji}</span>
          {sportName}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("venuesIndexed", { count: total })}
          {totalPages > 1 && (
            <span className="text-sm">
              {" "}
              · {t("page", { current: page, total: totalPages })}
            </span>
          )}
        </p>
      </header>

      {venues.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          {t("emptyMessage")}{" "}
          <Link href="/" className="underline hover:text-foreground">
            {t("exploreOthers")}
          </Link>
        </p>
      ) : (
        <SportVenuesSection
          sportSlug={sport.slug}
          initialVenues={
            venues.map((v) => ({
              id: v.id,
              slug: v.slug,
              name: v.name,
              lat: v.lat,
              lon: v.lon,
              family_slug: v.family_slug,
              primary_sport_slug: v.primary_sport_slug,
            })) as VenuePin[]
          }
          totalSportVenues={total}
          mapHint={t("mapHint", { sport: sportName.toLowerCase() })}
        >
          {/* Mode "ancré" (défaut) : grille SSR indexable + pagination. */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} />
            ))}
          </section>

          {totalPages > 1 && (
            <nav
              className="mt-12 flex items-center justify-center gap-4 text-sm"
              aria-label="Pagination"
            >
              {page > 1 ? (
                <Link
                  href={`/sports/${sportSlug}?page=${page - 1}`}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {t("previous")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {t("previous")}
                </span>
              )}
              <span className="text-muted-foreground">
                {t("page", { current: page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/sports/${sportSlug}?page=${page + 1}`}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {t("next")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {t("next")}
                </span>
              )}
            </nav>
          )}
        </SportVenuesSection>
      )}
    </main>
  );
}
