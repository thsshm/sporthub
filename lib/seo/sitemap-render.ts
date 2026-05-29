/**
 * Sérialiseurs XML pour sitemap-index et urlset.
 * Module pur : aucune dépendance Supabase/next-intl pour tests faciles.
 */

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: number;
  /** alternates hreflang par locale */
  alternates?: Record<string, string>;
};

/** Échappe les caractères XML spéciaux. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sérialise un array d'entries en XML urlset standard avec hreflang. */
export function renderUrlsetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : "";
      const changefreq = e.changefreq
        ? `    <changefreq>${e.changefreq}</changefreq>\n`
        : "";
      const priority =
        typeof e.priority === "number"
          ? `    <priority>${e.priority.toFixed(1)}</priority>\n`
          : "";
      const links = e.alternates
        ? Object.entries(e.alternates)
            .map(
              ([lang, href]) =>
                `    <xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(href)}" />`,
            )
            .join("\n") + "\n"
        : "";
      return `  <url>
    <loc>${escapeXml(e.loc)}</loc>
${lastmod}${changefreq}${priority}${links}  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;
}

/** Sérialise un sitemap-index XML qui référence des sous-sitemaps.
 *
 * Note : les URLs des sous-sitemaps n'ont PAS d'extension `.xml`. Vercel
 * intercepte les paths `.xml` comme fichiers statiques et court-circuite
 * Next.js Route Handlers, retournant 404. Le Content-Type XML servi par
 * `/sitemap/<n>` (200) est ce que Google parse — l'extension n'a pas
 * d'importance pour les crawlers. */
export function renderSitemapIndexXml(
  siteUrl: string,
  totalShards: number,
  lastmod: string,
): string {
  const items = Array.from({ length: totalShards }, (_, i) => {
    return `  <sitemap>
    <loc>${siteUrl}/sitemap/${i}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>`;
}
