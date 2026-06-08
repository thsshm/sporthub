import { describe, expect, it } from "vitest";
import {
  keepPopularCombos,
  sumFamilyCounts,
  type PopularCombo,
} from "@/lib/home-stats";

describe("sumFamilyCounts", () => {
  it("renvoie 0 pour un objet vide", () => {
    expect(sumFamilyCounts({})).toBe(0);
  });

  it("somme tous les counts familles", () => {
    expect(sumFamilyCounts({ raquette: 40628, combat: 331, yoga: 651 })).toBe(41610);
  });

  it("ignore les valeurs nulles/zéro sans planter", () => {
    expect(sumFamilyCounts({ a: 0, b: 10, c: 0 })).toBe(10);
  });
});

describe("keepPopularCombos (#462)", () => {
  const mk = (sport: string, city: string): PopularCombo => ({
    sport,
    citySlug: city,
    cityLabel: city,
  });

  it("ne garde que les combos avec ≥ min lieux", () => {
    const withCount = [
      { combo: mk("padel", "paris"), count: 1397 },
      { combo: mk("tennis", "lyon"), count: 2 }, // page maigre → exclue
      { combo: mk("surf", "biarritz"), count: 0 }, // vide → exclue
      { combo: mk("yoga", "bordeaux"), count: 5 }, // pile au seuil → gardée
    ];
    const kept = keepPopularCombos(withCount, 5);
    expect(kept.map((c) => c.citySlug)).toEqual(["paris", "bordeaux"]);
  });

  it("renvoie une liste vide si aucun combo ne qualifie", () => {
    const withCount = [
      { combo: mk("tennis", "lyon"), count: 1 },
      { combo: mk("surf", "biarritz"), count: 4 },
    ];
    expect(keepPopularCombos(withCount, 5)).toEqual([]);
  });
});
