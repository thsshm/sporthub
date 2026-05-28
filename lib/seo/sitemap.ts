/**
 * Helpers partagés pour générer le sitemap-index et les sub-sitemaps.
 *
 * Pourquoi un index : Google limite chaque fichier sitemap à 50 000 URLs ou 50 MB.
 * En prod, on a ~348k venues + des pages programmatiques (sport × ville), donc on splite
 * en plusieurs sub-sitemaps référencés par un index à `/sitemap.xml`.
 *
 * Structure :
 *   - `/sitemap.xml`              → sitemap-index (liste les sub-sitemaps)
 *   - `/sitemap/static.xml`       → pages statiques (home, /map, /sports/*)
 *   - `/sitemap/programmatic.xml` → pages programmatiques (sport × pays × ville)
 *   - `/sitemap/venues-0.xml`     → venues 0..49999
 *   - `/sitemap/venues-1.xml`     → venues 50000..99999
 *   - …                           → autant que nécessaire pour couvrir tous les venues
 *
 * Tous les helpers respectent la limite 50k URLs par fichier (cf. `SITEMAP_URL_CAP`).
 */

import type { MetadataRoute } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";

export const SITE_URL = "https://sporthubmap.com";

/**
 * Locales supportées par le site. Doit rester en sync avec `i18n/routing.ts`.
 * On duplique ici la liste pour éviter d'importer `next-intl/routing` qui charge
 * indirectement `next/navigation` (incompatible avec l'environnement node de vitest).
 */
const LOCALES = ["fr", "en", "zh"] as const;
const DEFAULT_LOCALE = "fr" as const;

/** Cap Google par sub-sitemap (URLs). 50 MB n'est pas atteint avec nos entries compactes. */
export const SITEMAP_URL_CAP = 50000;

/** Préfixe de slug pour les sub-sitemaps venues. `venues-0`, `venues-1`, ... */
export const VENUE_SLUG_PREFIX = "venues-";

export type VenueRow = { slug: string; updated_at: string | null };
export type ComboRow = {
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
export function localized(
  path: string,
  meta: Partial<MetadataRoute.Sitemap[number]> = {},
): MetadataRoute.Sitemap[number] {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [
      l,
      `${SITE_URL}${l === DEFAULT_LOCALE ? path : `/${l}${path}`}`,
    ]),
  );
  return {
    url: languages[DEFAULT_LOCALE],
    alternates: { languages },
    ...meta,
  };
}

/** Pages statiques + pages famille (point d'entrée vers le sport principal). */
export function buildStaticEntries(now: Date = new Date()): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = [
    localized("/", { lastModified: now, changeFrequency: "daily", priority: 1.0 }),
    localized("/map", { lastModified: now, changeFrequency: "daily", priority: 0.9 }),
  ];

  const familyEntries: MetadataRoute.Sitemap = FAMILIES.map((family) =>
    localized(`/sports/${family.sports[0]}`, {
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    }),
  );

  return [...staticEntries, ...familyEntries];
}

/**
 * Compte les venues publiées non supprimées.
 * Utilise `count: "exact", head: true` pour ne pas charger les rows.
 */
export async function countPublishedVenues(): Promise<number> {
  const sb = getSupabaseServerClient();
  const { count } = await sb
    .from("venue")
    .select("*", { count: "exact", head: true })
    .eq("is_published", true)
    .is("deleted_at", null);
  return count ?? 0;
}

/**
 * Combien de sub-sitemaps `venues` faut-il pour couvrir tous les venues ?
 * `count = 348000` ⇒ 7 sub-sitemaps (0..6).
 */
export async function getVenueSitemapCount(): Promise<number> {
  const count = await countPublishedVenues();
  if (count === 0) return 1; // au moins un sub-sitemap vide pour éviter un index orphelin
  return Math.ceil(count / SITEMAP_URL_CAP);
}

/**
 * Récupère le slot `index` (0-based) des venues, paginé par `SITEMAP_URL_CAP`.
 * Trie par `id` pour une pagination stable.
 */
export async function fetchVenuePage(
  index: number,
  now: Date = new Date(),
): Promise<MetadataRoute.Sitemap> {
  const sb = getSupabaseServerClient();
  const from = index * SITEMAP_URL_CAP;
  const to = from + SITEMAP_URL_CAP - 1;

  const { data } = await sb
    .from("venue")
    .select("slug, updated_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .range(from, to);

  return ((data as VenueRow[]) ?? []).map((v) =>
    localized(`/venue/${v.slug}`, {
      lastModified: v.updated_at ? new Date(v.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.8,
    }),
  );
}

/**
 * Pages programmatiques (sport × pays × ville) dédupliquées en mémoire.
 *
 * Limitation actuelle : on requête au max `SITEMAP_URL_CAP` rows pour la dédup. Si plus
 * tard on dépasse 50k combos uniques, il faudra paginer aussi cette route (ou créer une
 * vue matérialisée DB des combos uniques).
 */
export async function fetchProgrammaticEntries(
  now: Date = new Date(),
): Promise<MetadataRoute.Sitemap> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("venue")
    .select("primary_sport_slug, country_code, city:city_id ( slug )")
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("city_id", "is", null)
    .not("country_code", "is", null)
    .not("primary_sport_slug", "is", null)
    .limit(SITEMAP_URL_CAP);

  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  for (const row of (data as ComboRow[]) ?? []) {
    if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) continue;
    const key = `${row.primary_sport_slug}/${row.country_code.toLowerCase()}/${row.city.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(
      localized(`/${key}`, {
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.9,
      }),
    );
  }
  return entries;
}

/**
 * Construit la liste des sub-sitemaps à référencer dans l'index.
 * Chaque entry : `{ url, lastModified }`.
 */
export async function buildSitemapIndex(
  now: Date = new Date(),
): Promise<Array<{ url: string; lastModified: Date }>> {
  const venuePages = await getVenueSitemapCount();
  const entries: Array<{ url: string; lastModified: Date }> = [
    { url: `${SITE_URL}/sitemap/static.xml`, lastModified: now },
    { url: `${SITE_URL}/sitemap/programmatic.xml`, lastModified: now },
  ];
  for (let i = 0; i < venuePages; i++) {
    entries.push({
      url: `${SITE_URL}/sitemap/${VENUE_SLUG_PREFIX}${i}.xml`,
      lastModified: now,
    });
  }
  return entries;
}

/**
 * Parse un slug de route comme `venues-3.xml` et retourne l'index venue.
 * Retourne `null` si le slug n'a pas le format attendu.
 */
export function parseVenueSlug(slug: string): number | null {
  if (!slug.endsWith(".xml")) return null;
  const base = slug.slice(0, -".xml".length);
  if (!base.startsWith(VENUE_SLUG_PREFIX)) return null;
  const indexStr = base.slice(VENUE_SLUG_PREFIX.length);
  // Refuse les préfixes (`-01`, `-1.5`, vide) — seul un entier ≥ 0 est accepté.
  if (!/^\d+$/.test(indexStr)) return null;
  return Number.parseInt(indexStr, 10);
}

/**
 * Sérialise un array d'entries `{ url, lastModified }` en XML sitemap-index valide.
 */
export function renderSitemapIndexXml(
  entries: Array<{ url: string; lastModified: Date }>,
): string {
  const items = entries
    .map(
      (e) =>
        `  <sitemap><loc>${escapeXml(e.url)}</loc><lastmod>${e.lastModified.toISOString()}</lastmod></sitemap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}

/**
 * Sérialise un `MetadataRoute.Sitemap` en XML urlset standard, incluant les hreflang
 * `xhtml:link` quand des `alternates.languages` sont présents.
 *
 * On ne s'appuie pas sur Next pour ça car ce module est consommé par des Route Handlers
 * (`route.ts`) — pas des metadata files — pour pouvoir co-exister avec le sitemap-index
 * manuel à `/sitemap.xml`.
 */
export function renderSitemapXml(entries: MetadataRoute.Sitemap): string {
  const urls = entries
    .map((entry) => {
      const lastmod =
        entry.lastModified instanceof Date
          ? entry.lastModified.toISOString()
          : typeof entry.lastModified === "string"
            ? entry.lastModified
            : undefined;
      const lastmodTag = lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "";
      const changefreq = entry.changeFrequency
        ? `    <changefreq>${entry.changeFrequency}</changefreq>\n`
        : "";
      const priority =
        typeof entry.priority === "number"
          ? `    <priority>${entry.priority.toFixed(1)}</priority>\n`
          : "";

      const languages = entry.alternates?.languages ?? {};
      const xhtmlLinks = Object.entries(languages)
        .map(
          ([lang, href]) =>
            `    <xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(String(href))}" />`,
        )
        .join("\n");
      const xhtmlBlock = xhtmlLinks ? `${xhtmlLinks}\n` : "";

      return `  <url>
    <loc>${escapeXml(entry.url)}</loc>
${lastmodTag}${changefreq}${priority}${xhtmlBlock}  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;
}

/** Échappe les caractères XML spéciaux dans une URL/string. */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
