/**
 * `/sitemap/[slug]` — gère tous les sub-sitemaps référencés par `/sitemap.xml`.
 *
 * Slugs supportés (avec extension `.xml`) :
 *   - `static.xml`       → pages statiques (home, /map, /sports/*)
 *   - `programmatic.xml` → pages programmatiques (sport × pays × ville)
 *   - `venues-N.xml`     → page N des venues (50 000 URLs max par page)
 *
 * Tout autre slug retourne 404.
 */
import { NextResponse } from "next/server";
import {
  buildStaticEntries,
  fetchProgrammaticEntries,
  fetchVenuePage,
  getVenueSitemapCount,
  parseVenueSlug,
  renderSitemapXml,
} from "@/lib/seo/sitemap";

export const revalidate = 3600;

const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
};

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  const { slug } = params;

  if (slug === "static.xml") {
    return new NextResponse(renderSitemapXml(buildStaticEntries()), {
      headers: XML_HEADERS,
    });
  }

  if (slug === "programmatic.xml") {
    return new NextResponse(renderSitemapXml(await fetchProgrammaticEntries()), {
      headers: XML_HEADERS,
    });
  }

  const venueIndex = parseVenueSlug(slug);
  if (venueIndex !== null) {
    const maxIndex = (await getVenueSitemapCount()) - 1;
    if (venueIndex > maxIndex) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return new NextResponse(renderSitemapXml(await fetchVenuePage(venueIndex)), {
      headers: XML_HEADERS,
    });
  }

  return new NextResponse("Not Found", { status: 404 });
}
