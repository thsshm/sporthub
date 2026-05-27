import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildVenueMetadata, buildVenueJsonLd } from "@/lib/seo/metadata";
import { SportChips } from "@/components/venue/SportChips";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { googleMapsUrl, appleMapsUrl, wazeUrl } from "@/lib/utils";
import type { VenueDetail } from "@/lib/supabase/types";

type Props = { params: { slug: string } };

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

  // Supabase joint city comme objet imbriqué — on flatten pour matcher VenueDetail
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const venue = await fetchVenue(params.slug);
  if (!venue) return { title: "Venue introuvable" };
  return buildVenueMetadata(venue, venue.city_name);
}

export default async function VenuePage({ params }: Props) {
  const venue = await fetchVenue(params.slug);
  if (!venue) notFound();

  const family = FAMILIES_BY_SLUG[venue.family_slug];
  const sportSlugs = (venue.sports ?? [])
    .map((s) => s.sport_slug)
    .filter(Boolean);
  const jsonLd = buildVenueJsonLd(venue, venue.city_name);
  const websiteHost = venue.website_url
    ? (() => {
        try {
          return new URL(venue.website_url!).host;
        } catch {
          return venue.website_url;
        }
      })()
    : null;

  return (
    <article className="container mx-auto max-w-3xl px-6 py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="border-b pb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="text-xl" aria-hidden="true">
            {family?.emoji ?? "🏟️"}
          </span>
          <span>{family?.name_fr ?? venue.family_slug}</span>
          {venue.city_name && <span aria-hidden="true">·</span>}
          {venue.city_name && <span>{venue.city_name}</span>}
          {venue.country_code && <span aria-hidden="true">·</span>}
          {venue.country_code && <span>{venue.country_code}</span>}
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{venue.name}</h1>
        {venue.description && (
          <p className="mt-3 text-muted-foreground">{venue.description}</p>
        )}
      </header>

      {sportSlugs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Sports pratiqués</h2>
          <SportChips sportSlugs={sportSlugs} />
        </section>
      )}

      <section className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        {venue.address && (
          <div>
            <dt className="font-medium text-muted-foreground">Adresse</dt>
            <dd>{venue.address}</dd>
          </div>
        )}
        {websiteHost && (
          <div>
            <dt className="font-medium text-muted-foreground">Site web</dt>
            <dd>
              <a
                className="underline hover:text-foreground"
                href={venue.website_url!}
                target="_blank"
                rel="noopener noreferrer"
              >
                {websiteHost}
              </a>
            </dd>
          </div>
        )}
        {venue.phone && (
          <div>
            <dt className="font-medium text-muted-foreground">Téléphone</dt>
            <dd>
              <a className="hover:underline" href={`tel:${venue.phone}`}>
                {venue.phone}
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-medium text-muted-foreground">Coordonnées GPS</dt>
          <dd className="font-mono text-xs">
            {venue.lat.toFixed(4)}, {venue.lon.toFixed(4)}
          </dd>
        </div>
      </section>

      <section className="mt-10 flex flex-wrap gap-2 border-t pt-6 text-sm">
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
    </article>
  );
}
