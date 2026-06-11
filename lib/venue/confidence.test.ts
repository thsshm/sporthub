import { describe, expect, it } from "vitest";
import {
  isLowConfidenceVenue,
  venueConfidenceIssues,
  type ConfidenceVenue,
} from "@/lib/venue/confidence";

// Fiche riche et cohérente → score élevé, nom aligné, courts plausibles.
const rich: ConfidenceVenue = {
  name: "Tennis Club de Lyon",
  primary_sport_slug: "tennis",
  family_slug: "raquette",
  address: "1 rue du Sport",
  city_name: "Lyon",
  website_url: "https://tcl.example",
  phone: "0102030405",
  description: "Club de tennis avec 8 courts.",
  courts_count: 8,
};

describe("venueConfidenceIssues (#613)", () => {
  it("fiche riche et cohérente → aucune raison (confiance)", () => {
    expect(venueConfidenceIssues(rich)).toEqual([]);
    expect(isLowConfidenceVenue(rich)).toBe(false);
  });

  it("fiche pauvre (nom + sport seulement) → incomplete", () => {
    const skeleton: ConfidenceVenue = { name: "Court municipal", primary_sport_slug: "tennis" };
    expect(venueConfidenceIssues(skeleton)).toContain("incomplete");
    expect(isLowConfidenceVenue(skeleton)).toBe(true);
  });

  it("nom ↔ sport douteux → name_sport_mismatch (même fiche par ailleurs riche)", () => {
    // « Tennis Club » présenté sur une page padel → suspect (#638).
    const issues = venueConfidenceIssues(rich, "padel");
    expect(issues).toContain("name_sport_mismatch");
    expect(isLowConfidenceVenue(rich, "padel")).toBe(true);
  });

  it("nombre de terrains invraisemblable → implausible_courts", () => {
    const inflated: ConfidenceVenue = { ...rich, courts_count: 112 }; // > seuil tennis 30
    expect(venueConfidenceIssues(inflated)).toContain("implausible_courts");
  });

  it("courts plausibles ou absents → pas de raison courts", () => {
    expect(venueConfidenceIssues({ ...rich, courts_count: 12 })).not.toContain(
      "implausible_courts",
    );
    expect(venueConfidenceIssues({ ...rich, courts_count: null })).not.toContain(
      "implausible_courts",
    );
    expect(venueConfidenceIssues({ ...rich, courts_count: 0 })).not.toContain(
      "implausible_courts",
    );
  });

  it("sportSlug par défaut = sport primaire de la venue", () => {
    // sans argument, utilise primary_sport_slug=tennis → cohérent → pas de mismatch.
    expect(venueConfidenceIssues(rich)).not.toContain("name_sport_mismatch");
  });

  it("cumule plusieurs raisons", () => {
    const bad: ConfidenceVenue = {
      name: "Piscine municipale", // contradiction sur tennis
      primary_sport_slug: "tennis",
      family_slug: "raquette",
      courts_count: 99, // implausible
      // pas d'adresse/contact → incomplete
    };
    const issues = venueConfidenceIssues(bad);
    expect(issues).toEqual(
      expect.arrayContaining(["incomplete", "name_sport_mismatch", "implausible_courts"]),
    );
  });
});
