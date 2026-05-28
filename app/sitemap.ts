import type { MetadataRoute } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { routing } from "@/i18n/routing";

const SITE_URL = "https://sporthubmap.com";

/**
 * Cap par child-sitemap. Google limite chaque sitemap à 50 000 URLs ou 50 MB.
 * 45 000 laisse une marge tranquille (URLs longues + hreflang × 3 locales =
 * verbosité XML qui peut faire gonfler le poids du fichier).
 */
const URLS_PER_SHARD = 45_000;

/**
 * Nombre de shards venues. 8 × 45k = 360k URLs venues max indexables.
 * Bumper si on dépasse (actuellement ~348k venues en prod).
 *
 * On préfère un nombre fixe plutôt qu'un `count` Supabase à chaque rebuild :
 *   - `count: "exact"` timeout sur la table venue (cf. perf fix #81 — la table
 *     a >200k rows et l'estimation exacte avec WHERE est lente)
 *   - `count: "planned"` est instable selon les stats Postgres du moment
 *   - shards "vides" (range > total rows) renvoient juste [] — Google les
 *     ignore silencieusement, c'est OK
 */
const VENUE_SHARD_COUNT = 8;

/**
 * Revalidate 24h : les sitemaps ne changent pas vite, Google re-crawl à sa
 * propre cadence (basée sur lastModified per URL). 9 shards × 45k rows =
 * grosse charge Supabase si on revalide trop souvent.
 */
export const revalidate = 86_400;

type VenueRow = { slug: string; updated_at: string | null };
type ComboRow = {
  primary_sport_slug: string | null;
  country_code: string | null;
  city: { slug?: string } | null;
};

/**
 * Construit une entry sitemap multi-locale avec hreflang via
 * `alternates.languages`.
 * - FR (default) = URL sans préfixe (préserve les URLs V1)
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

/**
 * Déclare les shards à générer. Next.js 14 invoque `sitemap({ id })` pour
 * chaque id retourné et produit `/sitemap/[id].xml`. Un sitemap-index racine
 * est auto-généré à `/sitemap.xml` listant tous les shards.
 *
 * Convention :
 *   - id 0  : pages statiques + familles + pages programmatiques (≤ 45k)
 *   - id 1..VENUE_SHARD_COUNT : venues paginées par tranche de 45k
 */
export async function generateSitemaps(): Promise<{ id: number }[]> {
  return Array.from({ length: VENUE_SHARD_COUNT + 1 }, (_, i) => ({ id: i }));
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  const sb = getSupabaseServerClient();
  const now = new Date();

  // Shard 0 : pages "métadonnées" (statiques + familles + programmatiques)
  if (id === 0) {
    const staticEntries: MetadataRoute.Sitemap = [
      localized("/", {
        lastModified: now,
        changeFrequency: "daily",
        priority: 1.0,
      }),
      localized("/map", {
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.9,
      }),
    ];

    const familyEntries: MetadataRoute.Sitemap = FAMILIES.map((family) =>
      localized(`/sports/${family.sports[0]}`, {
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.7,
      }),
    );

    // Pages programmatiques (sport × pays × ville) — dédup en mémoire.
    // On limite la query à URLS_PER_SHARD car la dédup réduit en pratique.
    const { data: combosData } = await sb
      .from("venue")
      .select("primary_sport_slug, country_code, city:city_id ( slug )")
      .eq("is_published", true)
      .is("deleted_at", null)
      .not("city_id", "is", null)
      .not("country_code", "is", null)
      .not("primary_sport_slug", "is", null)
      .limit(URLS_PER_SHARD);

    const seenCombos = new Set<string>();
    const programmaticEntries: MetadataRoute.Sitemap = [];
    for (const row of (combosData as ComboRow[]) ?? []) {
      if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) {
        continue;
      }
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

    return [...staticEntries, ...familyEntries, ...programmaticEntries];
  }

  // Shards 1..N : venues paginées. range() = OFFSET/LIMIT côté DB.
  // L'ordre par `id` (PK indexé) est stable et rapide.
  const offset = (id - 1) * URLS_PER_SHARD;
  const { data: venuesData } = await sb
    .from("venue")
    .select("slug, updated_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("id")
    .range(offset, offset + URLS_PER_SHARD - 1);

  return ((venuesData as VenueRow[]) ?? []).map((v) =>
    localized(`/venue/${v.slug}`, {
      lastModified: v.updated_at ? new Date(v.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.8,
    }),
  );
}
