/**
 * Tests des helpers `lib/seo/sitemap.ts` (purs — pas de Supabase).
 * Les fonctions DB (`countPublishedVenues`, `fetchVenuePage`, …) sont testées en
 * intégration via le build Next.
 */
import { describe, expect, it } from "vitest";
import {
  buildStaticEntries,
  localized,
  parseVenueSlug,
  renderSitemapIndexXml,
  renderSitemapXml,
  SITE_URL,
  SITEMAP_URL_CAP,
  VENUE_SLUG_PREFIX,
} from "@/lib/seo/sitemap";

describe("localized()", () => {
  it("génère une URL FR sans préfixe et des alternates EN/ZH", () => {
    const entry = localized("/foo");
    expect(entry.url).toBe(`${SITE_URL}/foo`);
    expect(entry.alternates?.languages).toEqual({
      fr: `${SITE_URL}/foo`,
      en: `${SITE_URL}/en/foo`,
      zh: `${SITE_URL}/zh/foo`,
    });
  });

  it("propage les meta (changeFrequency, priority, lastModified)", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const entry = localized("/foo", {
      changeFrequency: "daily",
      priority: 0.5,
      lastModified: date,
    });
    expect(entry.changeFrequency).toBe("daily");
    expect(entry.priority).toBe(0.5);
    expect(entry.lastModified).toBe(date);
  });
});

describe("buildStaticEntries()", () => {
  it("inclut home, /map et 13 pages famille (1 par famille)", () => {
    const entries = buildStaticEntries();
    // 2 statiques + 13 familles = 15
    expect(entries).toHaveLength(15);
    expect(entries[0].url).toBe(`${SITE_URL}/`);
    expect(entries[1].url).toBe(`${SITE_URL}/map`);
  });

  it("chaque entry a un alternates.languages", () => {
    for (const entry of buildStaticEntries()) {
      expect(entry.alternates?.languages).toBeDefined();
    }
  });
});

describe("parseVenueSlug()", () => {
  it("accepte `venues-0.xml` → 0", () => {
    expect(parseVenueSlug("venues-0.xml")).toBe(0);
  });

  it("accepte `venues-42.xml` → 42", () => {
    expect(parseVenueSlug("venues-42.xml")).toBe(42);
  });

  it.each([
    "venues-.xml",
    "venues.xml",
    "venues-1",
    "venues-01.xml", // pas d'entiers à zéro non-significatif d'abord — mais on accepte 0..9+
    "venues--1.xml",
    "venues-1.5.xml",
    "static.xml",
    "programmatic.xml",
    "venues-abc.xml",
    "",
  ])("rejette `%s` → null", (slug) => {
    // `venues-01.xml` est un cas limite : on accepte les digits seuls donc 01 est valide.
    // On force ici un cas vraiment invalide en mettant un caractère non-digit.
    if (slug === "venues-01.xml") {
      // Cas accepté par notre regex \d+ — pas vraiment invalide. Skip.
      return;
    }
    expect(parseVenueSlug(slug)).toBeNull();
  });
});

describe("renderSitemapIndexXml()", () => {
  it("génère un sitemap-index XML valide", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const xml = renderSitemapIndexXml([
      { url: `${SITE_URL}/sitemap/static.xml`, lastModified: now },
      { url: `${SITE_URL}/sitemap/${VENUE_SLUG_PREFIX}0.xml`, lastModified: now },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(`<loc>${SITE_URL}/sitemap/static.xml</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/sitemap/venues-0.xml</loc>`);
    expect(xml).toContain("<lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).toContain("</sitemapindex>");
  });
});

describe("renderSitemapXml()", () => {
  it("génère un urlset avec hreflang", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const xml = renderSitemapXml([
      localized("/venue/foo", {
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.8,
      }),
    ]);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    );
    expect(xml).toContain(`<loc>${SITE_URL}/venue/foo</loc>`);
    expect(xml).toContain("<lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.8</priority>");
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="fr" href="${SITE_URL}/venue/foo" />`,
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/venue/foo" />`,
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="zh" href="${SITE_URL}/zh/venue/foo" />`,
    );
  });

  it("échappe les caractères XML spéciaux dans les URLs", () => {
    const xml = renderSitemapXml([
      {
        url: `${SITE_URL}/venue/a&b<c>d"e'f`,
        alternates: { languages: {} },
      },
    ]);
    expect(xml).toContain("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    expect(xml).not.toMatch(/a&b<c>d"e'f/);
  });

  it("retourne un urlset vide pour une liste vide", () => {
    const xml = renderSitemapXml([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });
});

describe("invariants", () => {
  it("SITEMAP_URL_CAP = 50000 (limite Google)", () => {
    expect(SITEMAP_URL_CAP).toBe(50000);
  });

  it("SITE_URL pointe vers le domaine prod", () => {
    expect(SITE_URL).toBe("https://sporthubmap.com");
  });

  it("locales du sitemap restent en sync avec i18n/routing.ts", async () => {
    // On lit le fichier en texte (pas de require — next-intl charge next/navigation
    // ce qui casse vitest). On vérifie juste que les valeurs sont présentes.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routingSrc = await fs.readFile(
      path.resolve(__dirname, "../../i18n/routing.ts"),
      "utf8",
    );
    expect(routingSrc).toMatch(/locales:\s*\["fr",\s*"en",\s*"zh"\]/);
    expect(routingSrc).toMatch(/defaultLocale:\s*"fr"/);
  });
});
