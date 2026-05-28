/**
 * /sitemap/[shard] — sous-sitemaps shardés.
 *
 * Le param `shard` accepte les formes "0.xml", "1.xml", …, "8.xml".
 *   - 0  : pages statiques + 13 familles + pages programmatiques (≤ 45k entries)
 *   - 1..8 : venues paginées par tranche de 45 000 (360k venues max indexables)
 *
 * Pourquoi des Route Handlers explicites au lieu du convention metadata
 * `sitemap.ts` avec `generateSitemaps()` ? Voir `lib/seo/sitemap-shards.ts`.
 *
 * Cache 24h (mêmes raisons que l'index).
 */
import { NextResponse } from "next/server";
import {
  TOTAL_SHARD_COUNT,
  buildMetadataShard,
  buildVenueShard,
  renderUrlsetXml,
} from "@/lib/seo/sitemap-shards";

export const revalidate = 86_400;

// Pré-rend les 9 shards à build time, le reste est 404.
export function generateStaticParams(): { shard: string }[] {
  return Array.from({ length: TOTAL_SHARD_COUNT }, (_, i) => ({
    shard: `${i}.xml`,
  }));
}

export async function GET(
  _req: Request,
  { params }: { params: { shard: string } },
) {
  // Accepte "<n>.xml" ou "<n>" pour tolérance.
  const match = /^(\d+)(?:\.xml)?$/.exec(params.shard);
  if (!match) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const id = Number(match[1]);
  if (Number.isNaN(id) || id < 0 || id >= TOTAL_SHARD_COUNT) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const entries = id === 0 ? await buildMetadataShard() : await buildVenueShard(id);
  const xml = renderUrlsetXml(entries);
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
