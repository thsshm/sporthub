import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { LOW_QUALITY_THRESHOLD } from "@/lib/venue/quality-score";
import { isSportMismatch, sinkMismatches } from "@/lib/venue/sport-mismatch";
import { dedupeRelatedVenues } from "@/lib/venue/related-dedup";
import { VenueCard } from "@/components/venue/VenueCard";
import { SportVenuesSection } from "./SportVenuesSection";
import { SportPageCtaBar } from "./SportPageCtaBar";
import type { VenuePin } from "@/lib/supabase/types";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  buildItemListJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

const PAGE_SIZE = 24;
const POPULAR_CITIES_LIMIT = 10;

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
  venue_id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  family_slug: string;
  primary_sport_slug: string | null;
  address: string | null;
  courts_count: number | null;
  country_code: string | null;
  city_name: string | null;
  city_country: string | null;
};

type PopularCity = {
  city_name: string;
  city_slug: string;
  country_code: string;
  venue_count: number;
};

async function fetchPopularCities(sportSlug: string): Promise<PopularCity[]> {
  const sb = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("top_cities_for_sport", {
    p_sport_slug: sportSlug,
    p_limit: POPULAR_CITIES_LIMIT,
  });
  return (data as PopularCity[]) ?? [];
}

async function fetchVenues(
  sportSlug: string,
  page: number,
  filters: SportFilters,
  applyQuality = true,
) {
  const sb = getSupabaseServerClient();
  const offset = (page - 1) * PAGE_SIZE;

  // Filtre par APPARTENANCE au sport ({primary_sport_slug} ∪ venue_sport), via la
  // MV dénormalisée `mv_venue_sport_search` (#476) → une venue multi-sport (ex.
  // box Hyrox = gym) apparaît sur toutes ses pages sport, **cohérent avec la carte**
  // (venues_in_bbox/venues_aggregates lisent la même MV). La MV est pré-filtrée
  // is_published + non supprimée. count:'planned' = estimation planner (instantané,
  // comme avant) → pas de COUNT exact sur les gros sports (gym 174k).
  // mv_venue_sport_search est une vue matérialisée → absente des types Supabase
  // générés ; on type le builder en `any` (justifié), comme le cast rpc ailleurs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (sb as any)
    .from("mv_venue_sport_search")
    .select(
      `
      venue_id, slug, name, lat, lon, family_slug, primary_sport_slug, address,
      courts_count, country_code, city_name, city_country
    `,
      { count: "planned" }
    )
    .eq("sport_slug", sportSlug);

  // N'indexer/lister que les venues ≥ seuil qualité (#464). MAIS si ce filtre
  // ne laisse RIEN (sport dont 100% des venues sont des squelettes OSM, ex.
  // padel → 0 ≥ seuil), le caller re-fetch avec applyQuality=false pour ne
  // jamais afficher « No venue » alors que des spots existent (#550). La carte
  // reste exhaustive (API /api/venues).
  if (applyQuality) {
    query = query.gte("quality_score", LOW_QUALITY_THRESHOLD);
  }

  // Filtres spécifiques sport (#467) — booléens venue-level. Sémantique alignée
  // sur /api/venues?feat=… (KNOWN_FEAT) → carte et liste cohérentes.
  if (filters.indoor) query = query.eq("is_indoor", true);
  if (filters.lit) query = query.eq("has_lighting", true);
  if (filters.wheelchair) query = query.eq("is_wheelchair_accessible", true);
  if (filters.free) query = query.eq("fee_required", false);
  if (filters.paid) query = query.eq("fee_required", true);

  // Ranking par qualité décroissante (#563) — les meilleurs lieux d'abord, pas
  // l'ordre d'import. L'index (sport_slug, quality_score, venue_id) de la 0056
  // sert ce tri (sport_slug en égalité). venue_id en tie-break (pagination stable).
  const { data, error, count } = await query
    .order("quality_score", { ascending: false })
    .order("venue_id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) return { venues: [], total: 0 };

  const mapped = ((data as VenueRow[]) ?? []).map((v) => ({
    id: v.venue_id,
    slug: v.slug,
    name: v.name,
    lat: v.lat,
    lon: v.lon,
    family_slug: v.family_slug,
    primary_sport_slug: v.primary_sport_slug,
    address: v.address,
    courts_count: v.courts_count,
    city_name: v.city_name ?? undefined,
    country_code: v.country_code ?? v.city_country ?? undefined,
    // Cette venue matche `sportSlug` par appartenance (primary ou venue_sport).
    sport_slugs: [sportSlug],
  }));
  // Exclusion des noms contradictoires des résultats listés (#553) — la carte
  // reste exhaustive. Peut rendre une page < PAGE_SIZE cartes ; `total` est de
  // toute façon une estimation planner. En mode fallback (applyQuality=false,
  // sport 100% sous seuil #550), on RELÈGUE seulement en fin de page pour ne
  // pas re-créer « No venue » ; si le filtre vide la page qualité, le caller
  // bascule déjà sur ce fallback.
  // #637 : après le tri DB par quality_score (complétude), on RÉ-ORDONNE la page
  // par signal nom↔sport (#638) — positifs (« padel club ») remontés, suspects
  // (« tennis » sur /padel, loisir…) relégués, ordre qualité préservé par rang.
  // applyQuality exclut en plus les contradictions dures (#553) ; le fallback ne
  // fait que reléguer. Démotion avant exclusion.
  // #607 : provenance pour le badge de confiance sur les cards. `source` n'est
  // PAS dans la MV `mv_venue_sport_search` → 2e requête légère sur `venue` (≤
  // PAGE_SIZE ids déjà paginés), même pattern 2-temps que la page ville. Best-
  // effort : en cas d'erreur, on n'affiche simplement pas le badge.
  const ids = mapped.map((v) => v.id);
  const sourceById = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: srcRows } = await sb.from("venue").select("id, source").in("id", ids);
    for (const r of (srcRows as { id: string; source: string | null }[] | null) ?? []) {
      sourceById.set(r.id, r.source);
    }
  }
  const enriched = mapped.map((v) => ({ ...v, source: sourceById.get(v.id) ?? null }));

  // Dédup d'affichage (#698) : deux records du même lieu réel (variantes de nom /
  // sources, ex. « The Padellers » ×N au même endroit) ne s'affichent qu'une fois.
  // Nom normalisé (case/accents) + coords ≤ 250 m ; branches distinctes (> 250 m)
  // gardées. NB : dédup INTRA-PAGE (la liste est paginée côté SQL) → couvre le cas
  // le plus visible (doublons adjacents dans le classement). Display-only (#657).
  const deduped = dedupeRelatedVenues(enriched);
  const venues = sinkMismatches(
    applyQuality ? deduped.filter((v) => !isSportMismatch(v.name, sportSlug)) : deduped,
    sportSlug,
  );
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
  const tVenue = await getTranslations("venue");

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
  // Villes populaires uniquement page 1 sans filtre actif — fetch parallèle
  // avec les venues pour ne pas allonger le TTFB (#604).
  const showPopularCities = page === 1 && !anyFilterActive;
  const [venueResult, popularCities] = await Promise.all([
    fetchVenues(sportSlug, page, filters),
    showPopularCities ? fetchPopularCities(sportSlug) : Promise.resolve([] as PopularCity[]),
  ]);
  let { venues, total } = venueResult;
  // #550 — fallback anti « No venue » : si le filtre qualité ne laisse AUCUNE
  // venue sur cette page (sport dont 100% des venues sont des squelettes OSM,
  // ex. padel), on re-fetch SANS le gate qualité. On ne masque jamais un sport
  // qui a des données (la carte est exhaustive de toute façon). Le SEO des
  // pages trop maigres est traité par le noindex/redirect (#558), pas en
  // affichant « No venue ».
  if (venues.length === 0) {
    ({ venues, total } = await fetchVenues(sportSlug, page, filters, false));
  }
  const family = FAMILIES_BY_SLUG[sport.family_slug];
  // Compteur cohérent avec la liste réellement rendue (#470). `total` vient de
  // count:"planned" (estimation du planner Postgres) qui peut renvoyer 1 quand
  // la requête ne ramène en fait AUCUNE ligne → le header affichait
  // « 1 venue indexed » pendant que le corps affichait « No venue yet »
  // (contradiction signalée sur yoga retreat, même cause que #335). On force 0
  // dès que la liste est vide : header, pagination et corps ne se contredisent
  // plus jamais.
  const displayTotal = venues.length === 0 ? 0 : total;
  const totalPages = Math.max(1, Math.ceil(displayTotal / PAGE_SIZE));
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
        <p className="mt-2 text-base text-muted-foreground">
          {t("heroSubtitle", { sport: sportName.toLowerCase() })}
        </p>
        {/* CTAs — "Near me" (geolocation, client) + "Open map" link (#603).
            familySlug → la carte conserve le filtre famille du sport (#605). */}
        <SportPageCtaBar familySlug={sport.family_slug} />
        {/* Compteur seul, sans pagination technique (#604) — la navigation par
            page reste en bas de liste (vraie nav prev/suiv). */}
        <p className="mt-4 text-sm text-muted-foreground">
          {t("venuesIndexed", { count: displayTotal })}
        </p>
      </header>

      {/* Villes populaires — page 1 sans filtre uniquement (#604). */}
      {showPopularCities && popularCities.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            {t("popularCities")}
          </p>
          <div className="flex flex-wrap gap-2">
            {popularCities.map((city) => (
              <Link
                key={city.city_slug}
                href={`/${sportSlug}/${city.country_code.toLowerCase()}/${city.city_slug}`}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-accent"
              >
                {city.city_name}
                <span className="text-xs text-muted-foreground">({city.venue_count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}

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
        <div className="mt-12 text-center text-muted-foreground">
          {anyFilterActive ? (
            <p>
              {t("emptyMessage")}{" "}
              <Link
                href={sportHref(sportSlug, NO_FILTERS)}
                className="underline hover:text-foreground"
              >
                {tMap("resetFilters")}
              </Link>
            </p>
          ) : (
            <>
              <p>
                {t("emptyMessage")}{" "}
                <Link href="/" className="underline hover:text-foreground">
                  {t("exploreOthers")}
                </Link>
              </p>
              {/* CTA contribution (#467) : un sport sans lieu indexé est le
                  meilleur moment pour inviter à en ajouter un → /contribute. */}
              <p className="mt-3 text-sm">
                {tVenue("addPlacePrompt")}{" "}
                <Link href="/contribute" className="underline hover:text-foreground">
                  {tVenue("addPlaceCta")}
                </Link>
              </p>
            </>
          )}
        </div>
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
          totalSportVenues={displayTotal}
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
              <span className="text-xs text-muted-foreground/70">
                {/* #640 : sur la liste GLOBALE le total est énorme (« / 1295 »)
                    et inutile à l'utilisateur → on masque le total au-delà de 20
                    pages (la nav prev/suiv reste, crawlable). */}
                {totalPages > 20
                  ? t("pageShort", { current: page })
                  : t("page", { current: page, total: totalPages })}
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
