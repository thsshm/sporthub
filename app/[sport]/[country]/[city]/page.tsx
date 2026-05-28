import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { formatCount } from "@/lib/utils";

const PAGE_SIZE = 24;
const SITE_URL = "https://sporthubmap.com";

type Props = {
  params: { sport: string; country: string; city: string };
  searchParams: { page?: string };
};

export const revalidate = 86400; // 24h — counts city × sport changent peu

type Ctx = {
  sport: (typeof SPORTS_BY_SLUG)[string];
  city: { id: string; name: string; country_code: string };
  total: number;
};

/**
 * Résout sport + city + count en un seul passage (déduplicé entre
 * generateMetadata et la page via React cache()).
 */
const resolveContext = cache(async (params: Props["params"]): Promise<Ctx | null> => {
  const sport = SPORTS_BY_SLUG[params.sport];
  if (!sport) return null;

  const sb = getSupabaseServerClient();
  const { data: city } = await sb
    .from("city")
    .select("id, name, country_code")
    .eq("country_code", params.country.toUpperCase())
    .eq("slug", params.city)
    .maybeSingle();
  if (!city) return null;

  const { count } = await sb
    .from("venue")
    .select("id", { count: "exact", head: true })
    .eq("primary_sport_slug", params.sport)
    .eq("city_id", (city as { id: string }).id)
    .eq("is_published", true)
    .is("deleted_at", null);

  return {
    sport,
    city: city as Ctx["city"],
    total: count ?? 0,
  };
});

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
};

async function fetchVenues(ctx: Ctx, page: number) {
  const sb = getSupabaseServerClient();
  const offset = (page - 1) * PAGE_SIZE;

  // Mono-table query (primary_sport_slug) au lieu du inner join venue_sport.
  // Le inner-join timeout à >3s pour ce combo (sport + city + paginated).
  // Trade-off : on loupe les venues qui ont le sport en secondaire (vs primary).
  // Pour les pages programmatiques city × sport, l'utilisateur cherche les
  // venues *dédiés* à ce sport, donc primary_sport_slug est le bon filtre.
  const { data, error } = await sb
    .from("venue")
    .select(
      "id, slug, name, lat, lon, family_slug, primary_sport_slug, address, courts_count, country_code",
    )
    .eq("primary_sport_slug", ctx.sport.slug)
    .eq("city_id", ctx.city.id)
    .eq("is_published", true)
    .is("deleted_at", null)
    .range(offset, offset + PAGE_SIZE - 1)
    .order("id");

  if (error) return [];

  return ((data as VenueRow[]) ?? []).map((v) => ({
    ...v,
    city_name: ctx.city.name,
    country_code: v.country_code ?? ctx.city.country_code ?? undefined,
    sport_slugs: v.primary_sport_slug ? [v.primary_sport_slug] : [],
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await resolveContext(params);
  if (!ctx) return { title: "Page introuvable" };

  const title = `Clubs de ${ctx.sport.name_fr} à ${ctx.city.name} (${ctx.total} adresses)`;
  const description = `Liste complète des ${ctx.total} clubs et terrains de ${ctx.sport.name_fr} à ${ctx.city.name} — adresses, contacts, horaires.`.slice(
    0,
    160,
  );
  const path = `/${params.sport}/${params.country}/${params.city}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: `${SITE_URL}${path}`,
      title,
      description,
    },
  };
}

export default async function ProgrammaticPage({ params, searchParams }: Props) {
  const ctx = await resolveContext(params);
  if (!ctx) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const venues = await fetchVenues(ctx, page);
  const family = FAMILIES_BY_SLUG[ctx.sport.family_slug];
  const totalPages = Math.max(1, Math.ceil(ctx.total / PAGE_SIZE));
  const basePath = `/${params.sport}/${params.country}/${params.city}`;

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <header className="border-b pb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Accueil
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/sports/${params.sport}`} className="hover:text-foreground">
            {ctx.sport.name_fr}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{ctx.city.name}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{ctx.sport.emoji || family?.emoji}</span>
          {ctx.sport.name_fr} à {ctx.city.name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {formatCount(ctx.total)} adresse{ctx.total > 1 ? "s" : ""}
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
          Pas encore de venue pour {ctx.sport.name_fr} à {ctx.city.name}.{" "}
          <Link
            href={`/sports/${params.sport}`}
            className="underline hover:text-foreground"
          >
            Voir les autres villes
          </Link>
        </p>
      ) : (
        <>
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((v) => (
              <VenueCard key={v.id} venue={v} />
            ))}
          </section>

          {totalPages > 1 && (
            <nav
              className="mt-12 flex items-center justify-center gap-4 text-sm"
              aria-label="Pagination"
            >
              {page > 1 ? (
                <Link
                  href={`${basePath}?page=${page - 1}`}
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
                  href={`${basePath}?page=${page + 1}`}
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
