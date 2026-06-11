import { describe, expect, it } from "vitest";
import { formatVenueName } from "@/lib/format-venue-name";

describe("formatVenueName", () => {
  // Cas de l'issue #658 (vus sur /en/tennis/fr/lyon) : noms d'équipement bruts
  // tout en minuscules → casse phrase, accents FR préservés.
  it("sentence-case les noms d'équipement lowercase", () => {
    expect(formatVenueName("courts de tennis couverts")).toBe("Courts de tennis couverts");
    expect(formatVenueName("court de tennis béton poreux")).toBe("Court de tennis béton poreux");
    expect(formatVenueName("courts de tennis terre battue non gélive")).toBe(
      "Courts de tennis terre battue non gélive",
    );
  });

  it("préserve les accents (é, è) sans les casser", () => {
    expect(formatVenueName("école de voile")).toBe("École de voile");
    expect(formatVenueName("piscine extérieure")).toBe("Piscine extérieure");
  });

  it("ne casse-titre PAS chaque mot (français)", () => {
    // pas « Courts De Tennis »
    expect(formatVenueName("courts de tennis")).not.toContain(" De ");
  });

  it("garde les noms en casse mixte (noms propres) intacts", () => {
    expect(formatVenueName("Roland-Garros")).toBe("Roland-Garros");
    expect(formatVenueName("TC Paris 15")).toBe("TC Paris 15");
    expect(formatVenueName("Match Point NYC")).toBe("Match Point NYC");
    expect(formatVenueName("Club Forest Hill La Défense")).toBe("Club Forest Hill La Défense");
  });

  it("garde les noms tout-majuscule tels quels (acronymes ambigus)", () => {
    expect(formatVenueName("COURT DE PADEL")).toBe("COURT DE PADEL");
    expect(formatVenueName("INSEP")).toBe("INSEP");
  });

  it("gère vide / null / non-lettre", () => {
    expect(formatVenueName("")).toBe("");
    expect(formatVenueName(null)).toBe("");
    expect(formatVenueName(undefined)).toBe("");
    expect(formatVenueName("  ")).toBe("");
    expect(formatVenueName("12")).toBe("12");
  });

  it("un seul mot lowercase", () => {
    expect(formatVenueName("padel")).toBe("Padel");
  });
});
