import { describe, expect, it } from "vitest";
import type { SitemapEntry } from "@/lib/seo/sitemap-render";
import {
  renderSitemapIndexXml,
  renderUrlsetXml,
  shardIdRange,
} from "@/lib/seo/sitemap-render";

const SITE_URL = "https://sporthubmap.com";

/**
 * #333 — le sharding des venues passe d'un OFFSET (qui timeout sur 329k venues
 * → shards vides) à un découpage par tranche d'UUID, lu en keyset. On vérifie
 * ici que les tranches PAVENT tout l'espace id sans trou ni recouvrement.
 */
describe("shardIdRange (#333)", () => {
  const SHARDS = 8;

  it("le 1er shard démarre à l'UUID minimal", () => {
    expect(shardIdRange(1, SHARDS).start).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("le dernier shard n'a pas de borne haute (jusqu'au max UUID)", () => {
    expect(shardIdRange(SHARDS, SHARDS).end).toBeNull();
  });

  it("les tranches sont contiguës (fin shard i = début shard i+1)", () => {
    for (let i = 1; i < SHARDS; i++) {
      expect(shardIdRange(i, SHARDS).end).toBe(shardIdRange(i + 1, SHARDS).start);
    }
  });

  it("les bornes sont strictement croissantes (pas de recouvrement)", () => {
    const starts = Array.from({ length: SHARDS }, (_, i) =>
      shardIdRange(i + 1, SHARDS).start,
    );
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] > starts[i - 1]).toBe(true);
    }
  });

  it("chaque borne est un UUID bien formé", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (let i = 1; i <= SHARDS; i++) {
      const { start, end } = shardIdRange(i, SHARDS);
      expect(start).toMatch(uuid);
      if (end !== null) expect(end).toMatch(uuid);
    }
  });
});

// Doit rester aligné sur URLS_PER_SHARD dans lib/seo/sitemap-shards.ts.
// (On ne peut pas l'importer ici : ce module charge i18n/routing →
//  next-intl/navigation, incompatible avec l'environnement node de vitest.)
const URLS_PER_SHARD = 45_000;

describe("renderSitemapIndexXml", () => {
  const now = "2026-05-28T12:00:00.000Z";
  const xml = renderSitemapIndexXml(SITE_URL, 9, now);

  it("produit du XML valide (déclaration + namespace)", () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it("inclut exactement totalShards <sitemap> children", () => {
    const matches = xml.match(/<sitemap>/g);
    expect(matches?.length).toBe(9);
  });

  it("référence /sitemap/0.xml à /sitemap/N.xml", () => {
    for (let i = 0; i < 9; i++) {
      expect(xml).toContain(`${SITE_URL}/sitemap/${i}`);
    }
  });

  it("inclut lastmod sur chaque shard", () => {
    const matches = xml.match(/<lastmod>2026-05-28T12:00:00\.000Z<\/lastmod>/g);
    expect(matches?.length).toBe(9);
  });
});

describe("renderUrlsetXml", () => {
  it("produit du XML valide avec urlset + xhtml namespace", () => {
    const xml = renderUrlsetXml([]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("sérialise une URL avec lastmod / changefreq / priority", () => {
    const xml = renderUrlsetXml([
      {
        loc: "https://sporthubmap.com/test",
        lastmod: "2026-01-01T00:00:00.000Z",
        changefreq: "weekly",
        priority: 0.8,
      },
    ]);
    expect(xml).toContain("<loc>https://sporthubmap.com/test</loc>");
    expect(xml).toContain("<lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.8</priority>");
  });

  it("ajoute xhtml:link pour chaque langue alternate", () => {
    const xml = renderUrlsetXml([
      {
        loc: "https://sporthubmap.com/x",
        alternates: {
          fr: "https://sporthubmap.com/x",
          en: "https://sporthubmap.com/en/x",
          zh: "https://sporthubmap.com/zh/x",
        },
      },
    ]);
    expect(xml).toContain('hreflang="fr"');
    expect(xml).toContain('hreflang="en"');
    expect(xml).toContain('hreflang="zh"');
    expect(xml).toContain('href="https://sporthubmap.com/en/x"');
  });

  it("échappe les caractères XML spéciaux dans loc et href", () => {
    const xml = renderUrlsetXml([
      {
        loc: 'https://example.com/?a=1&b=<"x">',
        alternates: { fr: "https://example.com/?<a&b>" },
      },
    ]);
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&gt;");
    expect(xml).toContain("&quot;");
  });

  it("array vide produit un urlset vide mais valide", () => {
    const xml = renderUrlsetXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
  });
});

describe("audit poids shard (#108 part 2/2)", () => {
  // Limites Google par sitemap : 50 000 URLs ET 50 MB non-compressés.
  const GOOGLE_MAX_URLS = 50_000;
  const GOOGLE_MAX_BYTES = 50 * 1024 * 1024;

  /** Reproduit `localized()` de sitemap-shards pour une <url> venue. */
  function localizedVenue(slug: string): SitemapEntry {
    const path = `/venue/${slug}`;
    return {
      loc: `${SITE_URL}${path}`,
      lastmod: "2026-05-31T12:00:00.000Z",
      changefreq: "weekly",
      priority: 0.8,
      alternates: {
        fr: `${SITE_URL}${path}`,
        en: `${SITE_URL}/en${path}`,
        zh: `${SITE_URL}/zh${path}`,
      },
    };
  }

  /** Poids d'un shard plein de venues au slug donné (3 hreflang inclus). */
  function shardBytes(slug: string): number {
    const entry = localizedVenue(slug);
    const single = renderUrlsetXml([entry]);
    const empty = renderUrlsetXml([]);
    // Poids marginal d'une <url> = (xml 1 entry) − (xml vide) + le séparateur.
    const perUrl = Buffer.byteLength(single, "utf8") - Buffer.byteLength(empty, "utf8") + 1;
    return perUrl * URLS_PER_SHARD + Buffer.byteLength(empty, "utf8");
  }

  it("le cap respecte la limite des 50 000 URLs/sitemap", () => {
    expect(URLS_PER_SHARD).toBeLessThanOrEqual(GOOGLE_MAX_URLS);
  });

  it("un shard plein reste < 50 MB même avec un slug long (pire cas)", () => {
    // 75 caractères ≈ pire cas observé sur les slugs venue de la DB.
    const longSlug = "c".repeat(75);
    expect(shardBytes(longSlug)).toBeLessThan(GOOGLE_MAX_BYTES);
  });

  it("un shard plein avec slug moyen pèse < 30 MB (sanity)", () => {
    const medSlug = "complexe-sportif-municipal-saint-jean-de-luz";
    expect(shardBytes(medSlug)).toBeLessThan(30 * 1024 * 1024);
  });
});
