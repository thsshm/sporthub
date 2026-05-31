import { describe, expect, it } from "vitest";
import { renderUrlsetXml, renderSitemapIndexXml } from "./sitemap-render";

describe("renderUrlsetXml", () => {
  it("produit un urlset valide avec le prologue XML et les namespaces", () => {
    const xml = renderUrlsetXml([{ loc: "https://sporthubmap.com/" }]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain("<loc>https://sporthubmap.com/</loc>");
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
  });

  it("échappe les caractères XML spéciaux dans loc (& surtout)", () => {
    const xml = renderUrlsetXml([
      { loc: "https://x.com/s?a=1&b=2<test>'\"" },
    ]);
    expect(xml).toContain(
      "<loc>https://x.com/s?a=1&amp;b=2&lt;test&gt;&apos;&quot;</loc>",
    );
    // le & brut ne doit jamais subsister (sitemap invalide sinon)
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("omet les champs optionnels absents", () => {
    const xml = renderUrlsetXml([{ loc: "https://x.com/" }]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
    expect(xml).not.toContain("xhtml:link");
  });

  it("inclut les champs optionnels fournis", () => {
    const xml = renderUrlsetXml([
      {
        loc: "https://x.com/a",
        lastmod: "2026-05-31",
        changefreq: "weekly",
        priority: 0.8,
      },
    ]);
    expect(xml).toContain("<lastmod>2026-05-31</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.8</priority>");
  });

  it("formate la priority à une décimale", () => {
    const xml = renderUrlsetXml([{ loc: "https://x.com/", priority: 1 }]);
    expect(xml).toContain("<priority>1.0</priority>");
  });

  it("priority = 0 est rendu (pas confondu avec absent)", () => {
    const xml = renderUrlsetXml([{ loc: "https://x.com/", priority: 0 }]);
    expect(xml).toContain("<priority>0.0</priority>");
  });

  it("rend les alternates hreflang avec href échappé", () => {
    const xml = renderUrlsetXml([
      {
        loc: "https://x.com/a",
        alternates: {
          fr: "https://x.com/fr/a?x=1&y=2",
          en: "https://x.com/en/a",
        },
      },
    ]);
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="fr" href="https://x.com/fr/a?x=1&amp;y=2" />',
    );
    expect(xml).toContain('hreflang="en"');
  });

  it("gère plusieurs entries", () => {
    const xml = renderUrlsetXml([
      { loc: "https://x.com/a" },
      { loc: "https://x.com/b" },
    ]);
    expect((xml.match(/<url>/g) ?? []).length).toBe(2);
    expect((xml.match(/<\/url>/g) ?? []).length).toBe(2);
  });

  it("gère un urlset vide", () => {
    const xml = renderUrlsetXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });
});

describe("renderSitemapIndexXml", () => {
  it("produit un sitemapindex valide", () => {
    const xml = renderSitemapIndexXml("https://x.com", 3, "2026-05-31");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.trim().endsWith("</sitemapindex>")).toBe(true);
  });

  it("génère totalShards entrées <sitemap>, indexées de 0", () => {
    const xml = renderSitemapIndexXml("https://x.com", 3, "2026-05-31");
    expect((xml.match(/<sitemap>/g) ?? []).length).toBe(3);
    expect(xml).toContain("<loc>https://x.com/sitemap/0</loc>");
    expect(xml).toContain("<loc>https://x.com/sitemap/2</loc>");
    expect(xml).not.toContain("<loc>https://x.com/sitemap/3</loc>");
  });

  it("les sous-sitemaps n'ont PAS d'extension .xml (cf. quirk Vercel)", () => {
    const xml = renderSitemapIndexXml("https://x.com", 1, "2026-05-31");
    expect(xml).toContain("/sitemap/0</loc>");
    expect(xml).not.toContain("/sitemap/0.xml");
  });

  it("inclut lastmod sur chaque sous-sitemap", () => {
    const xml = renderSitemapIndexXml("https://x.com", 2, "2026-05-31");
    expect((xml.match(/<lastmod>2026-05-31<\/lastmod>/g) ?? []).length).toBe(2);
  });

  it("0 shard → index vide mais valide", () => {
    const xml = renderSitemapIndexXml("https://x.com", 0, "2026-05-31");
    expect(xml).toContain("<sitemapindex");
    expect(xml).not.toContain("<sitemap>");
  });
});
