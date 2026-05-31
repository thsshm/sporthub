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

/**
 * Cap par shard. 45k respecte les DEUX limites Google par sitemap :
 *   1. limite « nombre d'URLs »  : 50 000 max  → 45k OK (marge 10 %)
 *   2. limite « poids »          : 50 MB max   → voir audit ci-dessous
 *
 * Audit poids (#108 part 2/2, hreflang × 3 locales fr/en/zh comptés) :
 *   chaque <url> = <loc> + lastmod + changefreq + priority + 3 <xhtml:link>.
 *   Poids mesuré par <url> (cf. MIGRATION.md § « i18n routes /en /zh ») :
 *     - slug court  (~20 car.) : ~523 B  → 45k = 22,4 MB / shard
 *     - slug moyen  (~44 car.) : ~619 B  → 45k = 26,6 MB / shard
 *     - slug long   (~75 car.) : ~743 B  → 45k = 31,9 MB / shard
 *   Pire cas 31,9 MB < 50 MB : marge confortable. La limite « 50 000 URLs »
 *   est atteinte AVANT la limite poids (~70k URLs au pire cas), donc 45k
 *   reste le facteur contraignant — pas besoin de réduire le cap.
 */
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

  // Paginé pour contourner le cap PostgREST 1000 rows. On scanne jusqu'à
  // URLS_PER_SHARD rows sources, ce qui après dédup (sport × pays × ville)
  // donne un nombre de combos bien inférieur. Cf. PAGE_SIZE plus bas.
  const PAGE_SIZE_LOCAL = 1000;
  const allCombos: ComboRow[] = [];
  for (let from = 0; from < URLS_PER_SHARD; from += PAGE_SIZE_LOCAL) {
    const to = Math.min(from + PAGE_SIZE_LOCAL - 1, URLS_PER_SHARD - 1);
    const { data, error } = await sb
      .from("venue")
      .select("primary_sport_slug, country_code, city:city_id ( slug )")
      .eq("is_published", true)
      .is("deleted_at", null)
      .not("city_id", "is", null)
      .not("country_code", "is", null)
      .not("primary_sport_slug", "is", null)
      .order("id")
      .range(from, to);
    if (error || !data) break;
    allCombos.push(...(data as ComboRow[]));
    if (data.length < to - from + 1) break;
  }

  const seen = new Set<string>();
  const programmaticEntries: SitemapEntry[] = [];
  for (const row of allCombos) {
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

/**
 * Cap PostgREST par requête sur Supabase (max-rows = 1000 par défaut).
 * Pour récupérer URLS_PER_SHARD (45 000), on doit paginer en interne.
 */
const PAGE_SIZE = 1000;

/**
 * Shards 1..N : venues paginées par tranche de URLS_PER_SHARD.
 *
 * Implémentation : on accumule en batches de 1000 (limite PostgREST par
 * défaut). 45 batches × 8 shards = 360 requêtes par rebuild complet, exécuté
 * 1x/24h grâce à revalidate=86400.
 */
export async function buildVenueShard(shardIndex: number): Promise<SitemapEntry[]> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const shardStart = (shardIndex - 1) * URLS_PER_SHARD;
  const shardEnd = shardStart + URLS_PER_SHARD - 1;

  const venues: VenueRow[] = [];
  for (let from = shardStart; from <= shardEnd; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, shardEnd);
    const { data, error } = await sb
      .from("venue")
      .select("slug, updated_at")
      .eq("is_published", true)
      .is("deleted_at", null)
      .order("id")
      .range(from, to);
    if (error || !data) break;
    venues.push(...(data as VenueRow[]));
    // Si on a reçu moins que la taille demandée, on a atteint la fin de la
    // table — pas la peine de continuer les batches suivants pour ce shard.
    if (data.length < to - from + 1) break;
  }

  return venues.map((v) =>
    localized(`/venue/${v.slug}`, {
      lastmod: v.updated_at ?? now,
      changefreq: "weekly",
      priority: 0.8,
    }),
  );
}
