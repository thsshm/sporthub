import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG, getRelatedSports } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { SportPageMap } from "@/app/[locale]/sports/[sport]/SportPageMap";
import type { VenuePin } from "@/lib/supabase/types";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  buildItemListJsonLd,
  buildPlaceJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

const PAGE_SIZE = 24;
const SITE_URL = "https://sporthubmap.com";
/** En-dessous de ce nombre de lieux, la page sport×ville est trop maigre →
 * noindex (thin content, audit SEO #465). */
const NOINDEX_MIN_VENUES = 5;

type Params = { locale: string; sport: string; country: string; city: string };

type Props = {
  params: Params;
  searchParams: { page?: string };
};

export const revalidate = 86400; // 24h

type Ctx = {
  sport: (typeof SPORTS_BY_SLUG)[string];
  city: { id: string; name: string; country_code: string };
  total: number;
};

const resolveContext = cache(async (sport: string, country: string, city: string): Promise<Ctx | null> => {
  const sportDef = SPORTS_BY_SLUG[sport];
  if (!sportDef) return null;

  const sb = getSupabaseServerClient();
  const { data: cityRow } = await sb
    .from("city")
    .select("id, name, country_code")
    .eq("country_code", country.toUpperCase())
    .eq("slug", city)
    .maybeSingle();
  if (!cityRow) return null;

  // count=exact ICI (pas "planned") : la query est bornée par city_id, donc
  // l'index composite (primary_sport_slug, city_id) de la migration 0005 rend
  // le COUNT(*) trivial (≤ quelques milliers de lignes même pour une ville
  // dense). "planned" renvoyait une ESTIMATION du planner (ex : 6 pour
  // padel/paris) qui divergeait du vrai nombre de lignes rendues (1) → titre,
  // H1, meta et compteur carte mentaient au crawler/LLM (#335). NB : la page
  // mondiale /sports/[sport] (non bornée par ville) garde "planned" elle.
  const { count } = await sb
    .from("venue")
    .select("id", { count: "exact", head: true })
    .eq("primary_sport_slug", sport)
    .eq("city_id", (cityRow as { id: string }).id)
    .eq("is_published", true)
    .is("deleted_at", null);

  return {
    sport: sportDef,
    city: cityRow as Ctx["city"],
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

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, sport, country, city } = await params;
  const ctx = await resolveContext(sport, country, city);
  const t = await getTranslations({ locale, namespace: "programmatic" });
  const tSports = await getTranslations({ locale, namespace: "sports" });

  if (!ctx) {
    const tVenue = await getTranslations({ locale, namespace: "venue" });
    return { title: tVenue("notFoundTitle") };
  }

  const sportName = tSports.has(ctx.sport.slug)
    ? tSports(ctx.sport.slug)
    : ctx.sport.name_fr;
  // Titre sans le compteur quand 0 résultat : évite « … (0 adresses) » indexé
  // (audit SEO #465). Pour ≥ 1, on garde le compteur (chiffre réel utile).
  const title =
    ctx.total === 0
      ? t("titleNoCount", { sport: sportName, city: ctx.city.name })
      : t("title", { sport: sportName, city: ctx.city.name, count: ctx.total });
  const description = t("description", {
    sport: sportName.toLowerCase(),
    city: ctx.city.name,
    count: ctx.total,
  }).slice(0, 160);
  // noindex des pages trop maigres (< seuil) : thin content non indexable
  // (#465). follow:true → on laisse Google suivre les liens internes.
  const lowQuality = ctx.total < NOINDEX_MIN_VENUES;
  const path = `/${sport}/${country}/${city}`;
  // hreflang : page programmatique sport×ville déclinée en FR/EN/ZH (#108).
  const hreflang = buildHreflangAlternates(path);

  return {
    title,
    description,
    ...(lowQuality ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
    openGraph: { type: "website", url: `${SITE_URL}${path}`, title, description },
  };
}

export default async function ProgrammaticPage({ params, searchParams }: Props) {
  const { locale, sport, country, city } = (await Promise.resolve(params)) as Params;
  setRequestLocale(locale);

  const ctx = await resolveContext(sport, country, city);
  if (!ctx) notFound();

  const t = await getTranslations("programmatic");
  const tSport = await getTranslations("sport");
  const tFamilies = await getTranslations("families");
  const tSports = await getTranslations("sports");

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const venues = await fetchVenues(ctx, page);
  const family = FAMILIES_BY_SLUG[ctx.sport.family_slug];
  const totalPages = Math.max(1, Math.ceil(ctx.total / PAGE_SIZE));
  const basePath = `/${sport}/${country}/${city}`;
  const sportName = tSports.has(ctx.sport.slug) ? tSports(ctx.sport.slug) : ctx.sport.name_fr;

  // Sports voisins (même famille) → maillage interne SEO « sports proches
  // à {ville} » (#465). On lie la même ville pour chaque sport voisin.
  const relatedSports = getRelatedSports(ctx.sport.slug).filter((s) =>
    tSports.has(s),
  );

  // ── Schema.org JSON-LD : BreadcrumbList + Place (ville) + ItemList (venues).
  //    Trois marqueurs distincts pour aider Google à comprendre que la page
  //    parle d'un sport ET d'un lieu géographique ET liste des venues.
  const cityUrl = `${SITE_URL}/${locale}${basePath}`;
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Sport Hub", url: SITE_URL },
    {
      name: sportName,
      url: `${SITE_URL}/${locale}/sports/${ctx.sport.slug}`,
    },
    { name: ctx.city.name, url: cityUrl },
  ]);
  const placeJsonLd = buildPlaceJsonLd({
    name: ctx.city.name,
    country_code: ctx.city.country_code,
    url: cityUrl,
  });
  const itemListJsonLd = buildItemListJsonLd(
    `${sportName} · ${ctx.city.name}`,
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
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(placeJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemListJsonLd) }}
      />
      <header className="border-b pb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Sport Hub
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/sports/${sport}`} className="hover:text-foreground">
            {tFamilies(ctx.sport.family_slug)}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{ctx.city.name}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{ctx.sport.emoji || family?.emoji}</span>
          {t("h1", { sport: sportName, city: ctx.city.name })}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("addresses", { count: ctx.total })}
          {totalPages > 1 && (
            <span className="text-sm">
              {" "}
              · {tSport("page", { current: page, total: totalPages })}
            </span>
          )}
        </p>
      </header>

      {/* Contenu local : court paragraphe descriptif pour donner du texte
          indexable à la page (au-delà de la simple liste), audit SEO #465. */}
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {t("localIntro", { sport: sportName.toLowerCase(), city: ctx.city.name })}
      </p>

      {/* Sports proches dans la même ville → maillage interne (#465). */}
      {relatedSports.length > 0 && (
        <nav
          className="mt-4 flex flex-wrap items-center gap-2 text-sm"
          aria-label={t("relatedTitle", { city: ctx.city.name })}
        >
          <span className="font-medium text-foreground">
            {t("relatedTitle", { city: ctx.city.name })} :
          </span>
          {relatedSports.map((s) => (
            <Link
              key={s}
              href={`/${s}/${country}/${city}`}
              className="rounded-full border px-3 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tSports(s)}
            </Link>
          ))}
        </nav>
      )}

      {venues.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">
          <p>
            {t("emptyMessage", { sport: sportName, city: ctx.city.name })}{" "}
            <Link
              href={`/sports/${sport}`}
              className="underline hover:text-foreground"
            >
              {t("seeOtherCities")}
            </Link>
          </p>
          <p className="mt-3 text-sm">
            {t("addVenuePrompt")}{" "}
            <Link href="/contribute" className="underline hover:text-foreground">
              {t("addVenueCta")}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <SportPageMap
              sportSlug={sport}
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
              totalSportVenues={ctx.total}
            />
          </div>

          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  {tSport("previous")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {tSport("previous")}
                </span>
              )}
              <span className="text-muted-foreground">
                {tSport("page", { current: page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={`${basePath}?page=${page + 1}`}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {tSport("next")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {tSport("next")}
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
