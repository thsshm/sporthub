import { describe, expect, it } from "vitest";
import { formatRetreatDateRange, formatPriceFrom } from "@/lib/retreats";

// Assertions volontairement tolérantes (substrings) : la ponctuation/abréviation
// exacte d'Intl varie selon la version d'ICU/Node — on vérifie le sens, pas le
// caractère près.

describe("formatRetreatDateRange", () => {
  it("renvoie null quand aucune date", () => {
    expect(formatRetreatDateRange(null, null, "fr")).toBeNull();
  });

  it("formate une date de début seule", () => {
    const out = formatRetreatDateRange("2026-06-25", null, "fr");
    expect(out).toContain("2026");
    expect(out).toMatch(/juin/i);
    expect(out).toContain("25");
  });

  it("formate une date de fin seule (fallback)", () => {
    const out = formatRetreatDateRange(null, "2026-07-02", "fr");
    expect(out).toContain("2026");
    expect(out).toContain("2");
  });

  it("formate une plage dans le même mois avec les deux jours", () => {
    const out = formatRetreatDateRange("2026-06-25", "2026-06-30", "fr")!;
    expect(out).toContain("25");
    expect(out).toContain("30");
    expect(out).toMatch(/juin/i);
    expect(out).toContain("2026");
  });

  it("formate une plage à cheval sur deux mois", () => {
    const out = formatRetreatDateRange("2026-06-25", "2026-07-02", "fr")!;
    expect(out).toContain("25");
    expect(out).toMatch(/juin/i);
    expect(out).toContain("2026");
  });

  it("ancre en UTC (pas de décalage de jour)", () => {
    // 2026-06-25 ne doit jamais devenir le 24 quel que soit le fuseau du runner.
    expect(formatRetreatDateRange("2026-06-25", null, "en")).toContain("25");
  });

  it("produit une sortie non nulle pour en et zh", () => {
    expect(formatRetreatDateRange("2026-06-25", "2026-07-02", "en")).toBeTruthy();
    expect(formatRetreatDateRange("2026-06-25", "2026-07-02", "zh")).toBeTruthy();
  });
});

describe("formatPriceFrom", () => {
  it("renvoie null quand le montant est null", () => {
    expect(formatPriceFrom(null, "EUR", "fr")).toBeNull();
  });

  it("formate un montant EUR entier sans décimales", () => {
    const out = formatPriceFrom(490, "EUR", "fr")!;
    expect(out).toContain("490");
    expect(out).not.toContain(",00");
  });

  it("retombe sur EUR quand la devise est vide", () => {
    expect(formatPriceFrom(100, "", "fr")).toBeTruthy();
  });
});
