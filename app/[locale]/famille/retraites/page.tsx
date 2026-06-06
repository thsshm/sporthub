import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { UpcomingRetreats } from "@/components/retreat/UpcomingRetreats";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  buildItemListJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";
import type { VenuePin } from "@/lib/supabase/types";

// Carte chargée côté client uniquement (MapLibre = browser-only).
const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

const PAGE_SIZE = 24;
const FAMILY_SLUG = "retraites";

export const revalidate = 3600;

// ─── SEO metadata ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "famille" });
  const hreflang = buildHreflangAlternates(`/famille/retraites`);
  return {
    title: t("retraites.title"),
    description: t("retraites.description"),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

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
  retreat_type: string | null;
  city?: { name?: string; country_code?: string } | null;
  venue_sport?: { sport_slug: string }[];
};

/** Types de retraite (cf. migration 0022). Sert aux chips de filtre. */
const RETREAT_TYPES = [
  "yoga_retreat",
  "surf_camp",
  "wellness_retreat",
  "fitness_bootcamp",
  "tennis_camp",
] as const;

async function fetchRetraites(page: number, type: string | null) {
  const sb = getSupabaseServerClient();
  const offset = (page - 1) * PAGE_SIZE;

  let query = sb
    .from("venue")
    .select(
      `
      id, slug, name, lat, lon, family_slug, primary_sport_slug, address,
      courts_count, country_code, retreat_type,
      city:city_id ( name, country_code ),
      venue_sport ( sport_slug )
    `,
      { count: "estimated" }
    )
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("retreat_type", "is", null);

  // Filtre optionnel par type de retraite (chips). Validé contre la liste connue.
  if (type && (RETREAT_TYPES as readonly string[]).includes(type)) {
    query = query.eq("retreat_type", type);
  }

  const { data, error, count } = await query.order("id").range(offset, offset + PAGE_SIZE - 1);

  if (error) throw error;
  return { venues: (data ?? []) as VenueRow[], total: count ?? 0 };
}

// ─── Page ──────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; type?: string }>;
};

export default async function FamilleRetraitesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const activeType =
    sp.type && (RETREAT_TYPES as readonly string[]).includes(sp.type) ? sp.type : null;
  // Suffixe query-string pour préserver le filtre type dans la pagination.
  const typeQS = activeType ? `&type=${activeType}` : "";

  const t = await getTranslations("famille");
  const tSport = await getTranslations("sport");
  const family = FAMILIES_BY_SLUG[FAMILY_SLUG];

  const { venues, total } = await fetchRetraites(page, activeType);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Venues pour la carte (pin minimal VenuePin)
  const initialVenues: VenuePin[] = venues.map((v) => ({
    id: v.id,
    slug: v.slug,
    name: v.name,
    lat: v.lat,
    lon: v.lon,
    family_slug: v.family_slug,
    primary_sport_slug: v.primary_sport_slug ?? null,
  }));

  // JSON-LD
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Sport Hub", url: "/" },
    { name: t("retraites.title"), url: "/famille/retraites" },
  ]);
  const itemList = buildItemListJsonLd(
    t("retraites.title"),
    venues.map((v) => ({
      name: v.name,
      url: `/venue/${v.slug}`,
    }))
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* JSON-LD */}
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumb) }} />
      <div dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemList) }} />

      {/* En-tête */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl shadow-sm"
            style={{ backgroundColor: family?.color ?? "#be185d" }}
            aria-hidden="true"
          >
            {family?.emoji ?? "🌿"}
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("retraites.title")}</h1>
            <p className="mt-1 text-muted-foreground">
              {tSport("venuesIndexed", { count: total })}
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-muted-foreground">{t("retraites.lead")}</p>
      </header>

      {/* Chips de filtre par type de retraite (#266). Lien serveur ?type= —
          fonctionne sans JS, conserve le SEO. "Tous" = pas de param. */}
      <nav className="mb-8 flex flex-wrap gap-2" aria-label={t("retraites.filterLabel")}>
        <Link
          href="/famille/retraites"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            activeType === null
              ? "border-transparent bg-primary text-primary-foreground"
              : "hover:bg-accent"
          }`}
        >
          {t("retraites.filterAll")}
        </Link>
        {RETREAT_TYPES.map((rt) => (
          <Link
            key={rt}
            href={`/famille/retraites?type=${rt}`}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              activeType === rt
                ? "border-transparent bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            {t(`retraites.types.${rt}`)}
          </Link>
        ))}
      </nav>

      {/* Carte */}
      {initialVenues.length > 0 && (
        <section
          className="mb-10 h-72 overflow-hidden rounded-xl border sm:h-96"
          aria-label={t("retraites.mapLabel")}
        >
          <MapClient
            initialLat={initialVenues[0].lat}
            initialLon={initialVenues[0].lon}
            initialZoom={3}
            presetVenues={initialVenues}
          />
        </section>
      )}

      {/* Grille venues */}
      {venues.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{tSport("emptyMessage")}</p>
      ) : (
        <section aria-label={t("retraites.listLabel")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {venues.map((v) => (
              <VenueCard
                key={v.id}
                venue={{
                  id: v.id,
                  slug: v.slug,
                  name: v.name,
                  lat: v.lat,
                  lon: v.lon,
                  family_slug: v.family_slug,
                  primary_sport_slug: v.primary_sport_slug ?? null,
                  address: v.address,
                  courts_count: v.courts_count,
                  country_code: v.country_code ?? undefined,
                  city_name:
                    typeof v.city === "object" && v.city !== null
                      ? (v.city as { name?: string }).name
                      : undefined,
                  sport_slugs: (v.venue_sport ?? []).map(
                    (vs: { sport_slug: string }) => vs.sport_slug
                  ),
                }}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-4" aria-label="Pagination">
              {page > 1 && (
                <Link
                  href={`/famille/retraites?page=${page - 1}${typeQS}`}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  {tSport("previous")}
                </Link>
              )}
              <span className="text-sm text-muted-foreground">
                {tSport("page", { current: page, total: totalPages })}
              </span>
              {page < totalPages && (
                <Link
                  href={`/famille/retraites?page=${page + 1}${typeQS}`}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  {tSport("next")}
                </Link>
              )}
            </nav>
          )}
        </section>
      )}

      {/* Stages à venir — données réelles depuis retreat_event (#266, palier 1) */}
      <UpcomingRetreats locale={locale} />
    </main>
  );
}
