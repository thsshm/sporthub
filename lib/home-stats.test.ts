import { describe, expect, it } from "vitest";
import { sumFamilyCounts } from "@/lib/home-stats";

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
