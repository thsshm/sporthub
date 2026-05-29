/**
 * Tests pour le slugify et la construction de venue.slug stable.
 *
 * On vérifie l'alignement avec `scripts/import_v1.py` (CLAUDE.md règle 9 :
 * tests obligatoires sur `lib/`).
 */
import { describe, it, expect } from "vitest";
import { slugify, venueSlugFromName } from "./slug";

describe("slugify", () => {
  it("transforms simple strings to lowercase ASCII", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes accents (NFKD)", () => {
    expect(slugify("Café Léa")).toBe("cafe-lea");
    expect(slugify("Pétanque Marseille")).toBe("petanque-marseille");
  });

  it("collapses non-alphanumeric runs into a single dash", () => {
    expect(slugify("Foo!!!Bar___Baz")).toBe("foo-bar-baz");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("returns 'untitled' for empty input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("handles non-Latin scripts by collapsing them to dashes / untitled", () => {
    // 中文 → no ASCII output → fallback "untitled"
    expect(slugify("中文")).toBe("untitled");
  });
});

describe("venueSlugFromName", () => {
  it("combines name slug with external ID suffix", () => {
    expect(venueSlugFromName("HYROX Paris 15", "hyrox/12345")).toBe(
      "hyrox-paris-15-hyrox-12345",
    );
  });

  it("caps the name part at 80 chars", () => {
    const longName = "a".repeat(120);
    const slug = venueSlugFromName(longName, "hyrox/1");
    // 80 char name + "-" + "hyrox-1" = 88
    expect(slug.startsWith("a".repeat(80))).toBe(true);
    expect(slug.endsWith("hyrox-1")).toBe(true);
  });

  it("caps the external suffix at 30 chars", () => {
    const slug = venueSlugFromName("Foo", "osm/way/" + "9".repeat(100));
    // suffix slug = "osm-way-99999...", truncated to 30 chars
    const parts = slug.split("-");
    const reconstructedSuffix = parts.slice(1).join("-");
    expect(reconstructedSuffix.length).toBeLessThanOrEqual(30);
  });

  it("falls back to 'untitled' if both name and suffix are empty", () => {
    expect(venueSlugFromName("", "")).toBe("untitled");
  });

  it("is stable for the same inputs (idempotence)", () => {
    const a = venueSlugFromName("Plage des Catalans", "osm/node/12345");
    const b = venueSlugFromName("Plage des Catalans", "osm/node/12345");
    expect(a).toBe(b);
  });
});
