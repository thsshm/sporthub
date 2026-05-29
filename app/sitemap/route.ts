/**
 * /sitemap — sitemap-index racine.
 *
 * Liste les 9 sous-sitemaps (1 metadata + 8 venues). Référencé par
 * `app/robots.ts`.
 *
 * Le dossier `app/sitemap.xml/` (avec `.xml` dans le nom) provoquait des
 * conflits de routing sur Vercel : tout path sous `/sitemap/*` était
 * intercepté comme fichier statique et retournait 404. On utilise donc
 * `app/sitemap/route.ts` (sans `.xml`), avec robots.txt pointant vers
 * `/sitemap` plutôt que `/sitemap.xml`. Google parse le Content-Type, pas
 * l'extension URL.
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
