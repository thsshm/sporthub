/**
 * `/sitemap.xml` — sitemap-index principal.
 *
 * Liste tous les sub-sitemaps (static, programmatic, venues-0..N). Cap par sub-sitemap :
 * 50 000 URLs (limite Google). Avec ~348k venues en prod, on génère 7 sub-sitemaps venues.
 *
 * Cf. `lib/seo/sitemap.ts` pour la logique partagée.
 */
import { NextResponse } from "next/server";
import { buildSitemapIndex, renderSitemapIndexXml } from "@/lib/seo/sitemap";

export const revalidate = 3600;

export async function GET() {
  const entries = await buildSitemapIndex();
  const xml = renderSitemapIndexXml(entries);
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
