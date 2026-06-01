import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildVenueMetadata,
  buildVenueJsonLd,
  buildBreadcrumbJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";
import { SportChips } from "@/components/venue/SportChips";
import { VenueHero } from "@/components/venue/VenueHero";
import { VenueAbout } from "@/components/venue/VenueAbout";
import { VenueInfoCard } from "@/components/venue/VenueInfoCard";
import { VenueReviewBadge } from "@/components/venue/VenueReviewBadge";
import { VenueAmenitiesList } from "@/components/venue/VenueAmenitiesList";
import { VenueSportsList } from "@/components/venue/VenueSportsList";
import { VenueAccessibility } from "@/components/venue/VenueAccessibility";
import { VenueBookingLinks } from "@/components/venue/VenueBookingLinks";
import { VenueRelated } from "@/components/venue/VenueRelated";
import { googleMapsUrl, appleMapsUrl, wazeUrl } from "@/lib/utils";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import type { VenueDetail } from "@/lib/supabase/types";

type Props = { params: { locale: string; slug: string } };

export const revalidate = 3600;

async function fetchVenue(slug: string): Promise<VenueDetail | null> {
  const sb = getSupabaseServerClient();
  // Single round-trip avec tous les joins nécessaires à la fiche enrichie (#127).
  // - venue.* (incluant enrichments JSONB)
  // - city : nom + pays
  // - venue_sport : surface, indoor, courts_count + joindre sport pour name_fr/en
  // - venue_amenity : joindre amenity pour name/emoji/category (douche, parking, PMR…)
  // - booking_link : partenaires de réservation actifs
  const { data, error } = await sb
    .from("venue")
    .select(
      `
      *,
      city:city_id ( name, country_code ),
      sports:venue_sport (
        sport_slug, is_primary, courts_count, surface,
        sport ( slug, name_fr, name_en, emoji, family_slug )
      ),
      amenities:venue_amenity (
        amenity_slug, detail,
        amenity ( slug, name_fr, name_en, emoji, category )
      ),
      booking_links:booking_link ( id, partner, url, sport_slug, is_active )
    `,
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const v = data as Record<string, unknown> & {
    city?: { name?: string; country_code?: string } | null;
    sports?: unknown[];
    amenities?: unknown[];
    booking_links?: { is_active?: boolean }[];
    country_code?: string | null;
  };
  return {
    ...(v as unknown as VenueDetail),
    city_name: v.city?.name,
    country_code: v.country_code ?? v.city?.country_code ?? null,
    sports: (v.sports ?? []) as VenueDetail["sports"],
    amenities: (v.amenities ?? []) as VenueDetail["amenities"],
    booking_links: (v.booking_links ?? []).filter(
      (b) => b?.is_active !== false,
    ) as VenueDetail["booking_links"],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const venue = await fetchVenue(slug);
  if (!venue) {
    const t = await getTranslations({ locale, namespace: "venue" });
    return { title: t("notFoundTitle") };
  }
  return buildVenueMetadata(venue, venue.city_name);
}

export default async function VenuePage({ params }: Props) {
  const { locale, slug } = (await Promise.resolve(params)) as {
    locale: string;
    slug: string;
  };
  setRequestLocale(locale);
  const t = await getTranslations("venue");

  const venue = await fetchVenue(slug);
  if (!venue) notFound();

  const sportSlugs = (venue.sports ?? []).map((s) => s.sport_slug).filter(Boolean);
  const jsonLd = buildVenueJsonLd(venue, venue.city_name);
  const safeLocale: "fr" | "en" | "zh" =
    locale === "en" || locale === "zh" ? locale : "fr";

  // BreadcrumbList — aide Google à comprendre Home → Famille → Venue (#94).
  const SITE_URL = "https://sporthubmap.com";
  const tFamilies = await getTranslations("families");
  const family = FAMILIES_BY_SLUG[venue.family_slug];
  const breadcrumbItems: { name: string; url: string }[] = [
    { name: "Sport Hub", url: SITE_URL },
  ];
  if (family) {
    breadcrumbItems.push({
      name: tFamilies(venue.family_slug),
      url: `${SITE_URL}/${locale}/sports/${family.slug}`,
    });
  }
  breadcrumbItems.push({
    name: venue.name,
    url: `${SITE_URL}/${locale}/venue/${venue.slug}`,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);

  return (
    <article className="container mx-auto max-w-4xl px-6 py-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }}
      />

      <VenueHero venue={venue} cityName={venue.city_name} locale={locale} />

      {/* Layout 2 colonnes sur desktop : contenu principal / sidebar */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Colonne principale */}
        <div className="space-y-6">
          {sportSlugs.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sportsPracticed")}
              </h2>
              <SportChips sportSlugs={sportSlugs} />
            </section>
          )}

          <VenueAbout venue={venue} />

          <VenueSportsList venue={venue} locale={safeLocale} />

          <VenueAmenitiesList venue={venue} />

          <VenueAccessibility venue={venue} />

          {/* CTAs maps */}
          <section className="flex flex-wrap gap-2 border-t pt-4 text-sm">
            <a
              className="rounded-md border px-3 py-2 hover:bg-accent"
              href={googleMapsUrl(venue.lat, venue.lon, venue.name)}
              target="_blank"
              rel="noopener noreferrer"
            >
              📍 Google Maps
            </a>
            <a
              className="rounded-md border px-3 py-2 hover:bg-accent"
              href={appleMapsUrl(venue.lat, venue.lon, venue.name)}
              target="_blank"
              rel="noopener noreferrer"
            >
              🗺️ Apple Maps
            </a>
            <a
              className="rounded-md border px-3 py-2 hover:bg-accent"
              href={wazeUrl(venue.lat, venue.lon)}
              target="_blank"
              rel="noopener noreferrer"
            >
              🚗 Waze
            </a>
          </section>
        </div>

        {/* Sidebar : réservation + review + infos — sticky desktop (#layout) */}
        <aside className="space-y-4 lg:sticky lg:top-[calc(4rem+1rem)] lg:self-start">
          <VenueBookingLinks bookingLinks={venue.booking_links} />
          <VenueReviewBadge venue={venue} />
          <VenueInfoCard venue={venue} locale={safeLocale} />
        </aside>
      </div>

      {/* "Voir aussi" */}
      <div className="mt-12 border-t pt-8">
        <VenueRelated
          currentVenueId={venue.id}
          cityId={venue.city_id}
          primarySportSlug={venue.primary_sport_slug}
          familySlug={venue.family_slug}
        />
      </div>
    </article>
  );
}
