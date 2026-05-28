import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildSportMetadata } from "@/lib/seo/metadata";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { formatCount } from "@/lib/utils";
import { SportPageMap } from "./SportPageMap";
import type { VenuePin } from "@/lib/supabase/types";

const PAGE_SIZE = 24;

type Props = {
  params: { sport: string };
  searchParams: { page?: string };
};

export const revalidate = 3600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sport = SPORTS_BY_SLUG[params.sport];
  if (!sport) return { title: "Sport introuvable" };
  return buildSportMetadata(sport.name_fr);
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
      { count: "exact" },
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
  const sport = SPORTS_BY_SLUG[params.sport];
  if (!sport) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const { venues, total } = await fetchVenues(params.sport, page);
  const family = FAMILIES_BY_SLUG[sport.family_slug];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <header className="border-b pb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Accueil
          </Link>
          <span aria-hidden="true">/</span>
          <span>{family?.name_fr ?? sport.family_slug}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{sport.emoji || family?.emoji}</span>
          {sport.name_fr}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {formatCount(total)} venue{total > 1 ? "s" : ""} indexé
          {total > 1 ? "s" : ""}
          {totalPages > 1 && (
            <span className="text-sm">
              {" "}
              · page {page} / {totalPages}
            </span>
          )}
        </p>
      </header>

      {venues.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          Aucun venue pour ce sport pour l&apos;instant.{" "}
          <Link href="/" className="underline hover:text-foreground">
            Explorer les autres sports
          </Link>
        </p>
      ) : (
        <>
          {/* Carte des venues de la page courante */}
          <div className="mt-6">
            <SportPageMap
              venues={
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
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Carte des {venues.length} venues de cette page. Pour explorer tous
              les {formatCount(total)} venues {sport.name_fr.toLowerCase()},{" "}
              <Link href="/map" className="underline hover:text-foreground">
                ouvre la carte mondiale
              </Link>
              .
            </p>
          </div>

          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  href={`/sports/${params.sport}?page=${page - 1}`}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  ← Précédent
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  ← Précédent
                </span>
              )}
              <span className="text-muted-foreground">
                Page {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/sports/${params.sport}?page=${page + 1}`}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  Suivant →
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  Suivant →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
