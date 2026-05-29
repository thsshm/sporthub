/**
 * /sitemap.xml — sitemap-index racine.
 *
 * Liste les 9 sous-sitemaps (1 metadata + 8 venues). Référencé par robots.ts.
 * Google découvre les sous-sitemaps via cet index.
 *
 * Cache 24h (les listes changent peu, Google re-crawl à sa cadence).
 */
import { NextResponse } from "next/server";
import { renderSitemapIndexXml } from "@/lib/seo/sitemap-render";
import { SITE_URL, TOTAL_SHARD_COUNT } from "@/lib/seo/sitemap-shards";

export const revalidate = 86_400;

export function GET() {
  const xml = renderSitemapIndexXml(
    SITE_URL,
    TOTAL_SHARD_COUNT,
    new Date().toISOString(),
  );
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
