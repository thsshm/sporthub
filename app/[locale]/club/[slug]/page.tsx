/**
 * Page /club/[slug] — fiche club (#373).
 *
 * Un « club » regroupe plusieurs venues (courts/terrains) via venue.club_id
 * (clustering #311). Cette page liste les courts du club, chacun linkant vers
 * sa fiche /venue/[slug]. Pré-requis du classement par club (#366) : les
 * /disciplines/* pointeront ici.
 *
 * Lecture seule, ISR (revalidate 1h), client statique (service_role, reads
 * publics : venues publiés non supprimés). Requête venues indexée par
 * idx_venue_club_id → pas de timeout.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { MapPin, ExternalLink, ChevronRight } from "lucide-react";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { FAMILIES_BY_SLUG, getFamilyColor } from "@/lib/families";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { formatCount, googleMapsUrl } from "@/lib/utils";
import { unstable_cache } from "next/cache";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  jsonLdHtml,
} from "@/lib/seo/metadata";

export const revalidate = 3600;
const SITE_URL = "https://sporthubmap.com";

type ClubCourt = {
  id: string;
  slug: string;
  name: string;
  primary_sport_slug: string | null;
  sport_slugs: string[];
};

type ClubDetail = {
  id: string;
  slug: string;
  name: string;
  family_slug: string;
  city_name: string | null;
  country_code: string | null;
  lat: number;
  lon: number;
  courts: ClubCourt[];
  sport_slugs: string[];
};

const fetchClub = unstable_cache(
  async (slug: string): Promise<ClubDetail | null> => {
    const sb = getSupabaseStaticClient();
    try {
      const { data: club, error } = await sb
        .from("club")
        .select(
          `id, slug, name, family_slug, country_code, lat, lon,
           city:city_id ( name, country_code )`,
        )
        .eq("slug", slug)
        .maybeSingle();
      if (error || !club) return null;

      const c = club as unknown as {
        id: string;
        slug: string;
        name: string;
        family_slug: string;
        country_code: string | null;
        lat: number;
        lon: number;
        city: { name: string | null; country_code: string | null } | null;
      };

      const { data: venues } = await sb
        .from("venue")
        .select(`id, slug, name, primary_sport_slug, venue_sport ( sport_slug )`)
        .eq("club_id", c.id)
        .eq("is_published", true)
        .is("deleted_at", null)
        .order("name")
        .limit(200);

      const courts: ClubCourt[] = ((venues ?? []) as unknown[]).map((row) => {
        const v = row as {
          id: string;
          slug: string;
          name: string;
          primary_sport_slug: string | null;
          venue_sport: { sport_slug: string }[] | null;
        };
        return {
          id: v.id,
          slug: v.slug,
          name: v.name,
          primary_sport_slug: v.primary_sport_slug,
          sport_slugs: (v.venue_sport ?? []).map((s) => s.sport_slug),
        };
      });

      const sportSet = new Set<string>();
      for (const ct of courts) for (const s of ct.sport_slugs) sportSet.add(s);

      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        family_slug: c.family_slug,
        city_name: c.city?.name ?? null,
        country_code: c.country_code ?? c.city?.country_code ?? null,
        lat: c.lat,
        lon: c.lon,
        courts,
        sport_slugs: [...sportSet],
      };
    } catch {
      return null;
    }
  },
  ["club-detail"],
  { revalidate: 3600, tags: ["club"] },
);

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const club = await fetchClub(slug);
  const t = await getTranslations({ locale, namespace: "club" });
  if (!club) return { title: t("notFoundTitle") };
  const hreflang = buildHreflangAlternates(`/club/${slug}`);
  return {
    title: t("metaTitle", { club: club.name }),
    description: t("metaDescription", {
      club: club.name,
      city: club.city_name ?? "",
      count: club.courts.length,
    }),
    alternates: { canonical: hreflang.canonical, languages: hreflang.languages },
  };
}

export default async function ClubPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const club = await fetchClub(slug);
  if (!club) notFound();

  const t = await getTranslations("club");
  const tSports = await getTranslations("sports");
  const family = FAMILIES_BY_SLUG[club.family_slug];
  const familyColor = getFamilyColor(club.family_slug);
  const sportName = (s: string) =>
    tSports.has(s) ? tSports(s) : (SPORTS_BY_SLUG[s]?.name_fr ?? s);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: club.name,
    url: `${SITE_URL}/club/${club.slug}`,
    geo: {
      "@type": "GeoCoordinates",
      latitude: club.lat,
      longitude: club.lon,
    },
  };
  if (club.city_name) {
    jsonLd.address = {
      "@type": "PostalAddress",
      addressLocality: club.city_name,
      ...(club.country_code ? { addressCountry: club.country_code } : {}),
    };
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "SportHub", url: SITE_URL },
    { name: club.name, url: `${SITE_URL}/club/${club.slug}` },
  ]);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }} />

      {/* Hero */}
      <section className="border-b" style={{ borderTopColor: familyColor }}>
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: familyColor }}
          aria-hidden="true"
        />
        <div className="container mx-auto max-w-4xl px-6 py-10 md:py-14">
          <span className="text-4xl" aria-hidden="true">
            {family?.emoji}
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {club.name}
          </h1>
          {(club.city_name || club.country_code) && (
            <p className="mt-2 flex items-center gap-1.5 text-base text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {club.city_name}
              {club.country_code ? ` · ${club.country_code}` : ""}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {t("courtsCount", { count: formatCount(club.courts.length) })}
          </p>

          {/* Sports praticables */}
          {club.sport_slugs.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {club.sport_slugs.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs"
                >
                  <span aria-hidden="true">{SPORTS_BY_SLUG[s]?.emoji}</span>
                  {sportName(s)}
                </span>
              ))}
            </div>
          )}

          {/* CTA carte */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/map?family=${club.family_slug}`}
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: familyColor }}
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {t("viewOnMap")}
            </Link>
            <a
              href={googleMapsUrl(club.lat, club.lon)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t("openInMaps")}
            </a>
          </div>
        </div>
      </section>

      {/* Liste des courts */}
      <section className="container mx-auto max-w-4xl px-6 py-10">
        <h2 className="text-lg font-semibold">
          {t("courtsTitle", { club: club.name })}
        </h2>

        {club.courts.length === 0 ? (
          <p className="mt-6 text-center text-muted-foreground">{t("noCourts")}</p>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border bg-card">
            {club.courts.map((court) => (
              <li key={court.id}>
                <Link
                  href={`/venue/${court.slug}`}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium group-hover:underline">
                      {court.name}
                    </p>
                    {court.primary_sport_slug && (
                      <p className="truncate text-xs text-muted-foreground">
                        {sportName(court.primary_sport_slug)}
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
