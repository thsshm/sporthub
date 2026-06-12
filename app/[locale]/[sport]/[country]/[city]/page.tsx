import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import {
  CityPageView,
  buildCityMetadata,
  type CityPageParams,
} from "./CityPageView";

// Page 1 (canonique) de la liste sport×ville. STATIQUE/ISR : ne lit pas
// searchParams (la pagination passe par /page/N), client service_role sans
// cookies() → page cachée 24 h, crawl SEO rapide (cf. #191 + bug gym×ville).
export const revalidate = 86400; // 24 h
// `force-static` : SANS ça, Next défère ce segment dynamique en rendu on-demand
// NON caché (le fetch Supabase est `no-store` par défaut → page servie `no-store`,
// vérifié en prod). La page n'a AUCUNE API dynamique (build `dynamic:'error'` →
// `○ Static`), donc on FORCE le cache → vraie ISR (le fetch service_role est mis
// en cache pour `revalidate`). C'est ce qui complète réellement #674.
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<CityPageParams>;
}): Promise<Metadata> {
  const { locale, sport, country, city } = await params;
  return buildCityMetadata({ locale, sport, country, city, page: 1 });
}

export default async function Page({ params }: { params: CityPageParams }) {
  const { locale, sport, country, city } = await Promise.resolve(params);
  setRequestLocale(locale);
  return (
    <CityPageView
      locale={locale}
      sport={sport}
      country={country}
      city={city}
      page={1}
    />
  );
}
