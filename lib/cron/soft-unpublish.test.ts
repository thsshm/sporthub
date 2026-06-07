import { describe, expect, it } from "vitest";

/**
 * Tests de la logique pure du garde-plancher (#399).
 * On teste la logique de décision indépendamment de l'I/O Supabase.
 */

function shouldSkip(
  rowsUpserted: number,
  prevCount: number,
  minFraction = 0.9,
): boolean {
  const threshold = Math.floor(prevCount * minFraction);
  return rowsUpserted < threshold;
}

describe("softUnpublishMissing garde-plancher", () => {
  it("ne dépublie pas si le run est sous le seuil (fetch partiel)", () => {
    // 7400 venues connues, 5687 ramenées (~77 %) → sous les 90 % → skip
    expect(shouldSkip(5687, 7400)).toBe(true);
  });

  it("dépublie si le run est au-dessus du seuil", () => {
    // 7400 venues, 7000 ramenées (~94 %) → au-dessus de 90 % → go
    expect(shouldSkip(7000, 7400)).toBe(false);
  });

  it("dépublie si le run ramène exactement le seuil", () => {
    // floor(7400 * 0.9) = 6660 → seuil exact → go (>= threshold)
    expect(shouldSkip(6660, 7400)).toBe(false);
  });

  it("skip si le run ramène 1 de moins que le seuil", () => {
    expect(shouldSkip(6659, 7400)).toBe(true);
  });

  it("ne skip pas si prevCount = 0 (première exécution)", () => {
    // threshold = floor(0 * 0.9) = 0 → rowsUpserted (même 0) >= 0 → go
    expect(shouldSkip(0, 0)).toBe(false);
    expect(shouldSkip(100, 0)).toBe(false);
  });

  it("seuil configurable (minFraction = 0.8)", () => {
    // 7400 venues, seuil 80 % = 5920 → 5900 < 5920 → skip
    expect(shouldSkip(5900, 7400, 0.8)).toBe(true);
    // 5950 > 5920 → go
    expect(shouldSkip(5950, 7400, 0.8)).toBe(false);
  });
});
