import type { MetadataRoute } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { routing } from "@/i18n/routing";

const SITE_URL = "https://sporthubmap.com";

export const revalidate = 3600;

type VenueRow = { slug: string; updated_at: string | null };
type ComboRow = {
  primary_sport_slug: string | null;
  country_code: string | null;
  city: { slug?: string } | null;
};

/**
 * Construit une entry sitemap multi-locale avec hreflang via `alternates.languages`.
 * - FR (default locale) = URL sans préfixe (préserve les URLs V1)
 * - EN = /en/path
 * - ZH = /zh/path
 */
function localized(
  path: string,
  meta: Partial<MetadataRoute.Sitemap[number]> = {},
): MetadataRoute.Sitemap[number] {
  const languages = Object.fromEntries(
    routing.locales.map((l) => [
      l,
      `${SITE_URL}${l === routing.defaultLocale ? path : `/${l}${path}`}`,
    ]),
  );
  return {
    url: languages[routing.defaultLocale],
    alternates: { languages },
    ...meta,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = getSupabaseServerClient();
  const now = new Date();

  // Pages statiques
  const staticEntries: MetadataRoute.Sitemap = [
    localized("/", { lastModified: now, changeFrequency: "daily", priority: 1.0 }),
    localized("/map", { lastModified: now, changeFrequency: "daily", priority: 0.9 }),
  ];

  // Pages famille (point d'entrée vers le sport principal de chaque famille)
  const familyEntries: MetadataRoute.Sitemap = FAMILIES.map((family) =>
    localized(`/sports/${family.sports[0]}`, {
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    }),
  );

  // Pages venue (cap à 50k pour rester dans la limite Google par sitemap file)
  const { data: venuesData } = await sb
    .from("venue")
    .select("slug, updated_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .limit(50000);

  const venueEntries: MetadataRoute.Sitemap = ((venuesData as VenueRow[]) ?? []).map(
    (v) =>
      localized(`/venue/${v.slug}`, {
        lastModified: v.updated_at ? new Date(v.updated_at) : now,
        changeFrequency: "weekly",
        priority: 0.8,
      }),
  );

  // Pages programmatiques (sport × pays × ville) — dédup en mémoire
  const { data: combosData } = await sb
    .from("venue")
    .select("primary_sport_slug, country_code, city:city_id ( slug )")
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("city_id", "is", null)
    .not("country_code", "is", null)
    .not("primary_sport_slug", "is", null)
    .limit(50000);

  const seenCombos = new Set<string>();
  const programmaticEntries: MetadataRoute.Sitemap = [];
  for (const row of (combosData as ComboRow[]) ?? []) {
    if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) continue;
    const key = `${row.primary_sport_slug}/${row.country_code.toLowerCase()}/${row.city.slug}`;
    if (seenCombos.has(key)) continue;
    seenCombos.add(key);
    programmaticEntries.push(
      localized(`/${key}`, {
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.9,
      }),
    );
  }

  return [
    ...staticEntries,
    ...familyEntries,
    ...venueEntries,
    ...programmaticEntries,
  ];
}
