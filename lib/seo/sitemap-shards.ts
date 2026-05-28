/**
 * Helpers de fetching des entries pour les sitemap shards.
 *
 * Cette couche TOUCHE Supabase et next-intl (routing). Les sérialiseurs XML
 * purs sont dans `sitemap-render.ts` (pour les tests sans DB).
 *
 * Structure des routes :
 *   - /sitemap.xml              → sitemap-index (liste les 9 sous-sitemaps)
 *   - /sitemap/0.xml            → pages statiques + familles + programmatiques
 *   - /sitemap/1.xml … /8.xml   → venues paginés (45 000 chacun = 360k max)
 */

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { routing } from "@/i18n/routing";
import type { SitemapEntry } from "@/lib/seo/sitemap-render";

export const SITE_URL = "https://sporthubmap.com";

/** Cap par shard. 45k < 50k pour laisser de la marge poids (hreflang × 3 locales). */
export const URLS_PER_SHARD = 45_000;

/** 8 shards venues = 360k URLs venues max indexables (~348k actuels). */
export const VENUE_SHARD_COUNT = 8;

/** Total = 1 shard metadata + 8 shards venues = 9 sous-sitemaps. */
export const TOTAL_SHARD_COUNT = VENUE_SHARD_COUNT + 1;

type VenueRow = { slug: string; updated_at: string | null };
type ComboRow = {
  primary_sport_slug: string | null;
  country_code: string | null;
  city: { slug?: string } | null;
};

/**
 * Construit une entry multi-locale avec hreflang via alternates.
 * - FR (default) = URL sans préfixe (préserve les URLs V1)
 * - EN = /en/path
 * - ZH = /zh/path
 */
function localized(
  path: string,
  meta: Omit<SitemapEntry, "loc" | "alternates"> = {},
): SitemapEntry {
  const alternates = Object.fromEntries(
    routing.locales.map((l) => [
      l,
      `${SITE_URL}${l === routing.defaultLocale ? path : `/${l}${path}`}`,
    ]),
  );
  return {
    loc: alternates[routing.defaultLocale],
    alternates,
    ...meta,
  };
}

/** Shard 0 : pages statiques + familles + programmatiques (dédupliqués). */
export async function buildMetadataShard(): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();

  const staticEntries: SitemapEntry[] = [
    localized("/", { lastmod: now, changefreq: "daily", priority: 1.0 }),
    localized("/map", { lastmod: now, changefreq: "daily", priority: 0.9 }),
  ];

  const familyEntries: SitemapEntry[] = FAMILIES.map((f) =>
    localized(`/sports/${f.sports[0]}`, {
      lastmod: now,
      changefreq: "monthly",
      priority: 0.7,
    }),
  );

  const { data: combosData } = await sb
    .from("venue")
    .select("primary_sport_slug, country_code, city:city_id ( slug )")
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("city_id", "is", null)
    .not("country_code", "is", null)
    .not("primary_sport_slug", "is", null)
    .limit(URLS_PER_SHARD);

  const seen = new Set<string>();
  const programmaticEntries: SitemapEntry[] = [];
  for (const row of (combosData as ComboRow[]) ?? []) {
    if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) {
      continue;
    }
    const key = `${row.primary_sport_slug}/${row.country_code.toLowerCase()}/${row.city.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    programmaticEntries.push(
      localized(`/${key}`, {
        lastmod: now,
        changefreq: "weekly",
        priority: 0.9,
      }),
    );
  }

  return [...staticEntries, ...familyEntries, ...programmaticEntries];
}

/** Shards 1..N : venues paginées par tranche de URLS_PER_SHARD. */
export async function buildVenueShard(shardIndex: number): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const offset = (shardIndex - 1) * URLS_PER_SHARD;

  const { data } = await sb
    .from("venue")
    .select("slug, updated_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("id")
    .range(offset, offset + URLS_PER_SHARD - 1);

  return ((data as VenueRow[]) ?? []).map((v) =>
    localized(`/venue/${v.slug}`, {
      lastmod: v.updated_at ?? now,
      changefreq: "weekly",
      priority: 0.8,
    }),
  );
}
