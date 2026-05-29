import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildVenueMetadata, buildVenueJsonLd } from "@/lib/seo/metadata";
import { SportChips } from "@/components/venue/SportChips";
import { VenueHero } from "@/components/venue/VenueHero";
import { VenueInfoCard } from "@/components/venue/VenueInfoCard";
import { VenueReviewBadge } from "@/components/venue/VenueReviewBadge";
import { VenueAmenitiesList } from "@/components/venue/VenueAmenitiesList";
import { VenueRelated } from "@/components/venue/VenueRelated";
import { googleMapsUrl, appleMapsUrl, wazeUrl } from "@/lib/utils";
import type { VenueDetail } from "@/lib/supabase/types";

type Props = { params: { locale: string; slug: string } };

export const revalidate = 3600;

async function fetchVenue(slug: string): Promise<VenueDetail | null> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("venue")
    .select(
      `
      *,
      city:city_id ( name, country_code ),
      sports:venue_sport ( sport_slug, is_primary, courts_count, surface )
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
    country_code?: string | null;
  };
  return {
    ...(v as unknown as VenueDetail),
    city_name: v.city?.name,
    country_code: v.country_code ?? v.city?.country_code ?? null,
    sports: (v.sports ?? []) as VenueDetail["sports"],
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

  return (
    <article className="container mx-auto max-w-4xl px-6 py-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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

          <VenueAmenitiesList venue={venue} />

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

        {/* Sidebar : review + infos */}
        <aside className="space-y-4">
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
