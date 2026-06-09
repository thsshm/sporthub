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
  buildHreflangAlternates,
  buildItemListJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

const PAGE_SIZE = 24;

type Props = {
  params: { locale: string; sport: string };
  searchParams: {
    page?: string;
    indoor?: string;
    lit?: string;
    wheelchair?: string;
    free?: string;
    paid?: string;
  };
};

export const revalidate = 3600;

/** Filtres spécifiques sport, portés par l'URL (#467). Limités aux booléens
 * portés par la table `venue` elle-même (is_indoor / has_lighting /
 * is_wheelchair_accessible / fee_required) : on ne touche PAS au join `venue_sport`
 * (épars → pages vides, cf. #332). La `surface`, qui vit sur venue_sport, reste
 * hors scope. `free` et `paid` adressent la MÊME colonne fee_required (false/true)
 * → mutuellement exclusifs côté UI (cocher l'un décoche l'autre). */
type SportFilters = {
  indoor: boolean;
  lit: boolean;
  wheelchair: boolean;
  free: boolean;
  paid: boolean;
};

type SportFilterKey = keyof SportFilters;

/** Toutes les puces, dans l'ordre d'affichage. */
const FILTER_KEYS: SportFilterKey[] = ["indoor", "lit", "wheelchair", "free", "paid"];

const NO_FILTERS: SportFilters = {
  indoor: false,
  lit: false,
  wheelchair: false,
  free: false,
  paid: false,
};

/** Construit une URL /sports/[sport] en préservant filtres + page. Les valeurs
 * par défaut (false / page 1) sont omises → URLs propres et canoniques. */
function sportHref(sportSlug: string, f: SportFilters & { page?: number }): string {
  const sp = new URLSearchParams();
  if (f.indoor) sp.set("indoor", "1");
  if (f.lit) sp.set("lit", "1");
  if (f.wheelchair) sp.set("wheelchair", "1");
  if (f.free) sp.set("free", "1");
  if (f.paid) sp.set("paid", "1");
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return `/sports/${sportSlug}${qs ? `?${qs}` : ""}`;
}

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
  // hreflang : /sports/[sport] décliné en FR/EN/ZH (#108).
  const hreflang = buildHreflangAlternates(`/sports/${sportSlug}`, locale);
  return {
    title: name,
    description: tSport("metaDescription", { sport: name }),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
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
};

async function fetchVenues(sportSlug: string, page: number, filters: SportFilters) {
  const sb = getSupabaseServerClient();
  const offset = (page - 1) * PAGE_SIZE;

  // On filtre sur `venue.primary_sport_slug` (colonne dénormalisée sur venue),
  // PAS sur le join M:N `venue_sport`. Raison (#332) : la table `venue_sport`
  // est éparse — elle ne couvre que certains sports (padel, surf, golf…),
  // laissant yoga/boxing/judo/diving/running SANS aucune ligne → pages vides,
  // alors que ces venues existent bel et bien avec ce sport en primaire. Tout
  // le reste de l'app (page sport×ville, API /venues, sitemap, compteurs
  // famille) clé déjà sur `primary_sport_slug` ; cette page était l'outlier.
  let query = sb
    .from("venue")
    .select(
      `
      id, slug, name, lat, lon, family_slug, primary_sport_slug, address,
      courts_count, country_code,
      city:city_id ( name, country_code )
    `,
      { count: "planned" }
    )
    .eq("primary_sport_slug", sportSlug)
    .eq("is_published", true)
    .is("deleted_at", null);

  // Filtres spécifiques sport (#467) — booléens venue-level. Sémantique alignée
  // sur /api/venues?feat=… (KNOWN_FEAT) → carte et liste cohérentes.
  if (filters.indoor) query = query.eq("is_indoor", true);
  if (filters.lit) query = query.eq("has_lighting", true);
  if (filters.wheelchair) query = query.eq("is_wheelchair_accessible", true);
  if (filters.free) query = query.eq("fee_required", false);
  if (filters.paid) query = query.eq("fee_required", true);

  const { data, error, count } = await query
    .range(offset, offset + PAGE_SIZE - 1)
    .order("id", { ascending: true });

  if (error) return { venues: [], total: 0 };

  const venues = ((data as VenueRow[]) ?? []).map((v) => ({
    ...v,
    city_name: v.city?.name,
    country_code: v.country_code ?? v.city?.country_code ?? undefined,
    sport_slugs: v.primary_sport_slug ? [v.primary_sport_slug] : [],
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
  const tMap = await getTranslations("map");

  const filters: SportFilters = {
    indoor: searchParams.indoor === "1",
    lit: searchParams.lit === "1",
    wheelchair: searchParams.wheelchair === "1",
    free: searchParams.free === "1",
    paid: searchParams.paid === "1",
  };
  const anyFilterActive = FILTER_KEYS.some((k) => filters[k]);
  // Critères envoyés à la carte (MapClient → /api/venues?feat=…) pour que pins
  // et liste affichent le même sous-ensemble filtré (#467). Les clés matchent
  // KNOWN_FEAT de l'API (indoor/lit/wheelchair/free/paid).
  const selectedCriteria: string[] = FILTER_KEYS.filter((k) => filters[k]);

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const { venues, total } = await fetchVenues(sportSlug, page, filters);
  const family = FAMILIES_BY_SLUG[sport.family_slug];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sportName = tSports.has(sport.slug) ? tSports(sport.slug) : sport.name_fr;

  // Libellés i18n via le namespace `map.feat.*` (déjà en 3 locales, zéro
  // nouvelle clé). Clés littérales → type-safe next-intl.
  const featLabel: Record<SportFilterKey, string> = {
    indoor: tMap("feat.indoor"),
    lit: tMap("feat.lit"),
    wheelchair: tMap("feat.wheelchair"),
    free: tMap("feat.free"),
    paid: tMap("feat.paid"),
  };

  // Barre de filtres spécifiques sport (#467) — liens SSR, fonctionnels sans JS
  // et crawlables. Chaque puce bascule son param et remet la page à 1. `free` et
  // `paid` visent la même colonne fee_required → cocher l'un décoche l'autre
  // (sinon résultat vide systématique : fee_required ne peut être true ET false).
  const filterChips = FILTER_KEYS.map((key) => {
    const next: SportFilters = { ...filters, [key]: !filters[key] };
    if (key === "free" && next.free) next.paid = false;
    if (key === "paid" && next.paid) next.free = false;
    return { key, active: filters[key], href: sportHref(sportSlug, next) };
  });

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
    }))
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
            <span className="text-sm"> · {t("page", { current: page, total: totalPages })}</span>
          )}
        </p>
      </header>

      {/* Filtres spécifiques sport (#467) — puces-liens SSR, sans JS, crawlables.
          Limités aux booléens venue-level (couvert / éclairage) pour rester
          cohérents entre la liste et la carte sans toucher venue_sport (#332). */}
      {(total > 0 || anyFilterActive) && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tMap("criteriaTitle")}
          </span>
          {filterChips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              aria-pressed={chip.active}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                chip.active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "hover:bg-accent"
              }`}
            >
              {featLabel[chip.key]}
            </Link>
          ))}
          {anyFilterActive && (
            <Link
              href={sportHref(sportSlug, NO_FILTERS)}
              className="ml-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              {tMap("resetFilters")}
            </Link>
          )}
        </div>
      )}

      {venues.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          {anyFilterActive ? (
            <>
              {t("emptyMessage")}{" "}
              <Link
                href={sportHref(sportSlug, NO_FILTERS)}
                className="underline hover:text-foreground"
              >
                {tMap("resetFilters")}
              </Link>
            </>
          ) : (
            <>
              {t("emptyMessage")}{" "}
              <Link href="/" className="underline hover:text-foreground">
                {t("exploreOthers")}
              </Link>
            </>
          )}
        </p>
      ) : (
        <SportVenuesSection
          sportSlug={sport.slug}
          selectedCriteria={selectedCriteria}
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
                  href={sportHref(sportSlug, { ...filters, page: page - 1 })}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {t("previous")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">{t("previous")}</span>
              )}
              <span className="text-muted-foreground">
                {t("page", { current: page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={sportHref(sportSlug, { ...filters, page: page + 1 })}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {t("next")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">{t("next")}</span>
              )}
            </nav>
          )}
        </SportVenuesSection>
      )}
    </main>
  );
}
