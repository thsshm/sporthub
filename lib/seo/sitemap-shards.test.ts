import { describe, expect, it } from "vitest";
import {
  renderSitemapIndexXml,
  renderUrlsetXml,
} from "@/lib/seo/sitemap-render";

const SITE_URL = "https://sporthubmap.com";

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
      expect(xml).toContain(`${SITE_URL}/sitemap/${i}.xml`);
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
