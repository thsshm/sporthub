import { describe, expect, it } from "vitest";
import { plausibleCourtCount } from "@/lib/venue/courts-plausibility";

describe("plausibleCourtCount", () => {
  it("garde une valeur plausible", () => {
    expect(plausibleCourtCount(8, "raquette")).toBe(8);
    expect(plausibleCourtCount(30, "raquette")).toBe(30);
    expect(plausibleCourtCount(1, "ballon")).toBe(1);
  });

  it("masque une valeur aberrante (au-dessus du seuil famille)", () => {
    expect(plausibleCourtCount(200, "raquette")).toBeNull();
    expect(plausibleCourtCount(45, "raquette")).toBeNull(); // > 40
    expect(plausibleCourtCount(35, "ballon")).toBeNull(); // > 30
  });

  it("respecte le seuil par défaut pour une famille inconnue", () => {
    expect(plausibleCourtCount(50, "famille_x")).toBe(50);
    expect(plausibleCourtCount(51, "famille_x")).toBeNull();
    expect(plausibleCourtCount(50, null)).toBe(50);
  });

  it("null/0/négatif → null (rien à afficher)", () => {
    expect(plausibleCourtCount(0, "raquette")).toBeNull();
    expect(plausibleCourtCount(null, "raquette")).toBeNull();
    expect(plausibleCourtCount(undefined, "raquette")).toBeNull();
    expect(plausibleCourtCount(-3, "raquette")).toBeNull();
  });

  // Régression #636 : les cartes de liste (VenueCard) affichaient des counts
  // aberrants pour le tennis (famille raquette, cap 40).
  it("masque les counts tennis aberrants vus sur /tennis/fr/lyon (#636)", () => {
    for (const n of [112, 84, 60, 48]) {
      expect(plausibleCourtCount(n, "raquette")).toBeNull();
    }
    // …mais garde un gros club crédible (≤ 40).
    expect(plausibleCourtCount(28, "raquette")).toBe(28);
    expect(plausibleCourtCount(40, "raquette")).toBe(40);
  });
});
