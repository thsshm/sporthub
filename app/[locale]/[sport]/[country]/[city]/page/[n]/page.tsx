import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  CityPageView,
  buildCityMetadata,
  type CityPageParams,
} from "../../CityPageView";
import { parsePageSegment } from "@/lib/seo/pagination";

// Pages 2+ de la liste sport×ville (`/[sport]/[country]/[city]/page/N`).
// STATIQUE/ISR comme la page 1 : N vient du segment de route, pas de
// searchParams. Remplace l'ancien `?page=N` (query = rendu dynamique, #191).
export const revalidate = 86400; // 24 h
// force-static : idem page 1 — force la mise en cache ISR (sinon rendu on-demand
// no-store). Le redirect /page/1 et le notFound (hors plage) restent OK en static
// (build vérifié → `○`).
export const dynamic = "force-static";

type PageParams = CityPageParams & { n: string };

/** Chemin canonique page 1 (localePrefix "as-needed" : fr sans préfixe). */
function basePath(p: CityPageParams): string {
  const path = `/${p.sport}/${p.country}/${p.city}`;
  return p.locale === "fr" ? path : `/${p.locale}${path}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, sport, country, city, n } = await params;
  const page = parsePageSegment(n);
  if (page == null) return {};
  return buildCityMetadata({ locale, sport, country, city, page });
}

export default async function PaginatedCityPage({ params }: { params: PageParams }) {
  const { locale, sport, country, city, n } = await Promise.resolve(params);
  const page = parsePageSegment(n);
  if (page == null) notFound();
  // /page/1 = doublon de la page canonique → 308 permanent vers la base.
  if (page === 1) permanentRedirect(basePath({ locale, sport, country, city }));
  setRequestLocale(locale);
  return (
    <CityPageView
      locale={locale}
      sport={sport}
      country={country}
      city={city}
      page={page}
    />
  );
}
