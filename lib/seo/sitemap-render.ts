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

/**
 * Borne basse (incluse) et haute (exclue) d'un shard venue, en UUID (#333).
 *
 * On découpe l'espace UUID v4 (venue.id réparti uniformément) en `shardCount`
 * tranches d'égale largeur sur le 1er octet. Chaque shard ne lit QUE sa
 * tranche, en keyset (`id > cursor`), via l'index PK → zéro OFFSET, pas de
 * statement_timeout (qui faisait des shards VIDES avec l'ancien OFFSET).
 *
 * `end = null` pour le dernier shard (borne haute = max UUID). Fonction pure
 * (placée ici plutôt que dans sitemap-shards.ts pour être testable sans la
 * dépendance Supabase/next-intl).
 */
export function shardIdRange(
  shardIndex: number,
  shardCount: number,
): { start: string; end: string | null } {
  const span = 256 / shardCount;
  const lo = Math.round((shardIndex - 1) * span);
  const hi = Math.round(shardIndex * span);
  const prefix = (n: number) =>
    `${n.toString(16).padStart(2, "0")}000000-0000-0000-0000-000000000000`;
  return {
    start: prefix(lo),
    end: shardIndex >= shardCount ? null : prefix(hi),
  };
}
