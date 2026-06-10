import { describe, expect, it } from "vitest";
import { formatCityName } from "./format-city";

describe("formatCityName", () => {
  it("title-cases all-uppercase names", () => {
    expect(formatCityName("PARIS")).toBe("Paris");
    expect(formatCityName("LYON")).toBe("Lyon");
    expect(formatCityName("MARSEILLE")).toBe("Marseille");
  });

  it("keeps already mixed-case names untouched", () => {
    expect(formatCityName("Paris")).toBe("Paris");
    expect(formatCityName("Saint-Étienne")).toBe("Saint-Étienne");
    expect(formatCityName("La Rochelle")).toBe("La Rochelle");
  });

  it("lowercases French particles in the middle", () => {
    expect(formatCityName("AIX-EN-PROVENCE")).toBe("Aix-en-Provence");
    expect(formatCityName("BOURG-EN-BRESSE")).toBe("Bourg-en-Bresse");
    expect(formatCityName("LA ROCHE-SUR-YON")).toBe("La Roche-sur-Yon");
  });

  it("capitalizes after an apostrophe", () => {
    expect(formatCityName("L'HAY-LES-ROSES")).toBe("L'Hay-les-Roses");
  });

  it("keeps short all-caps acronyms", () => {
    expect(formatCityName("NY")).toBe("NY");
    expect(formatCityName("LA")).toBe("LA");
  });

  it("handles hyphenated names", () => {
    expect(formatCityName("SAINT-DENIS")).toBe("Saint-Denis");
    expect(formatCityName("VILLENEUVE-LOUBET")).toBe("Villeneuve-Loubet");
  });

  it("handles empty / nullish input", () => {
    expect(formatCityName("")).toBe("");
    expect(formatCityName(null)).toBe("");
    expect(formatCityName(undefined)).toBe("");
    expect(formatCityName("  PARIS  ")).toBe("Paris");
  });

  it("does not force-lowercase a leading particle", () => {
    // « LE MANS » → « Le Mans » (particule en tête garde la majuscule).
    expect(formatCityName("LE MANS")).toBe("Le Mans");
    expect(formatCityName("LES ULIS")).toBe("Les Ulis");
  });
});
