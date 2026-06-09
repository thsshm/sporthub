import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import { VenueCard } from "@/components/venue/VenueCard";
import { SportChips } from "@/components/venue/SportChips";
import { ClubMap } from "./ClubMap";
import type { VenuePin } from "@/lib/supabase/types";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  buildItemListJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

const SITE_URL = "https://sporthubmap.com";
// Un club a peu de terrains ; ce cap évite tout coût pathologique sans paginer.
const MAX_COURTS = 200;

type Params = { locale: string; slug: string };
type Props = { params: Params };

export const revalidate = 86400; // 24h — données club quasi statiques

type ClubRow = {
  id: string;
  name: string;
  slug: string;
  family_slug: string;
  lat: number;
  lon: number;
  country_code: string | null;
  city: { name?: string; country_code?: string } | null;
};

type CourtRow = {
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

// country_code re-typé `string | undefined` (et non `string | null`) pour coller
// au contrat de VenueCard / VenuePin ; on coalesce null → undefined au mapping.
type Court = Omit<CourtRow, "country_code"> & {
  country_code?: string;
  city_name?: string;
  sport_slugs: string[];
};

type ClubData = {
  club: ClubRow;
  cityName: string | null;
  courts: Court[];
  sportSlugs: string[];
};

// cache() : generateMetadata et le composant partagent le même fetch (1 seul
// round-trip DB par requête). Même pattern que /[sport]/[country]/[city].
const fetchClub = cache(async (slug: string): Promise<ClubData | null> => {
  const sb = getSupabaseServerClient();
  const { data: clubRow } = await sb
    .from("club")
    .select("id, name, slug, family_slug, lat, lon, country_code, city:city_id ( name, country_code )")
    .eq("slug", slug)
    .maybeSingle();
  if (!clubRow) return null;
  const club = clubRow as unknown as ClubRow;

  const { data: courtsData } = await sb
    .from("venue")
    .select(
      "id, slug, name, lat, lon, family_slug, primary_sport_slug, address, courts_count, country_code",
    )
    .eq("club_id", club.id)
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("id")
    .limit(MAX_COURTS);

  const cityName = club.city?.name ?? null;
  const courts = ((courtsData as CourtRow[]) ?? []).map((v) => ({
    ...v,
    city_name: cityName ?? undefined,
    country_code: v.country_code ?? club.country_code ?? club.city?.country_code ?? undefined,
    sport_slugs: v.primary_sport_slug ? [v.primary_sport_slug] : [],
  }));

  // Sports présents dans le club = primaires distincts de ses terrains, dans
  // l'ordre d'apparition (déterministe pour le SSR).
  const seen = new Set<string>();
  const sportSlugs: string[] = [];
  for (const c of courts) {
    const s = c.primary_sport_slug;
    if (s && !seen.has(s)) {
      seen.add(s);
      sportSlugs.push(s);
    }
  }

  return { club, cityName, courts, sportSlugs };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await fetchClub(slug);
  const t = await getTranslations({ locale, namespace: "club" });
  if (!data) {
    return { title: t("notFoundTitle") };
  }
  const { club, cityName, courts } = data;
  const title = cityName ? `${club.name} — ${cityName}` : club.name;
  const description = (
    cityName
      ? t("metaDescription", { name: club.name, city: cityName, count: courts.length })
      : t("metaDescriptionNoCity", { name: club.name, count: courts.length })
  ).slice(0, 160);
  const path = `/club/${club.slug}`;
  const hreflang = buildHreflangAlternates(path, locale);
  return {
    title,
    description,
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
    openGraph: { type: "website", url: `${SITE_URL}${path}`, title, description },
  };
}

export default async function ClubPage({ params }: Props) {
  const { locale, slug } = (await Promise.resolve(params)) as Params;
  setRequestLocale(locale);

  const data = await fetchClub(slug);
  if (!data) notFound();
  const { club, cityName, courts, sportSlugs } = data;

  const t = await getTranslations("club");
  const tFamilies = await getTranslations("families");
  const family = FAMILIES_BY_SLUG[club.family_slug];

  // ── JSON-LD : SportsClub (lieu) + Breadcrumb + ItemList des terrains.
  const clubUrl = `${SITE_URL}/${locale}/club/${club.slug}`;
  const clubJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsClub",
    name: club.name,
    url: clubUrl,
    ...(cityName || club.country_code
      ? {
          address: {
            "@type": "PostalAddress",
            ...(cityName ? { addressLocality: cityName } : {}),
            ...(club.country_code ? { addressCountry: club.country_code } : {}),
          },
        }
      : {}),
    geo: {
      "@type": "GeoCoordinates",
      latitude: club.lat,
      longitude: club.lon,
    },
  };
  const breadcrumbItems: { name: string; url: string }[] = [
    { name: "Sport Hub", url: SITE_URL },
  ];
  if (family) {
    breadcrumbItems.push({
      name: tFamilies(club.family_slug),
      url: `${SITE_URL}/${locale}/sports/${family.slug}`,
    });
  }
  breadcrumbItems.push({ name: club.name, url: clubUrl });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);
  const itemListJsonLd = buildItemListJsonLd(
    club.name,
    courts.map((c) => ({ name: c.name, url: `${SITE_URL}/${locale}/venue/${c.slug}` })),
  );

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(clubJsonLd) }}
      />
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Sport Hub
          </Link>
          <span aria-hidden="true">/</span>
          {family ? (
            <>
              <Link href={`/sports/${family.slug}`} className="hover:text-foreground">
                {tFamilies(club.family_slug)}
              </Link>
              <span aria-hidden="true">/</span>
            </>
          ) : null}
          <span>{club.name}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{family?.emoji}</span>
          {club.name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {cityName ? <span>{cityName} · </span> : null}
          {t("courts", { count: courts.length })}
        </p>
        {sportSlugs.length > 0 && (
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("sportsHeading")}
            </h2>
            <SportChips sportSlugs={sportSlugs} />
          </div>
        )}
      </header>

      {courts.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          {t("emptyMessage")}{" "}
          {family ? (
            <Link href={`/sports/${family.slug}`} className="underline hover:text-foreground">
              {t("exploreFamily")}
            </Link>
          ) : null}
        </p>
      ) : (
        <>
          <div className="mt-6">
            <ClubMap
              center={{ lat: club.lat, lon: club.lon }}
              venues={
                courts.map((c) => ({
                  id: c.id,
                  slug: c.slug,
                  name: c.name,
                  lat: c.lat,
                  lon: c.lon,
                  family_slug: c.family_slug,
                  primary_sport_slug: c.primary_sport_slug,
                  club_id: club.id,
                })) as VenuePin[]
              }
            />
          </div>

          <section className="mt-8">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("courtsHeading")}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {courts.map((c) => (
                <VenueCard key={c.id} venue={c} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
