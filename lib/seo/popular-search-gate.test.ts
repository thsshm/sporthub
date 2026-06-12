import { describe, expect, it } from "vitest";
import {
  highConfidenceCardCount,
  isPopularSearchEligible,
  MIN_HIGH_CONFIDENCE_CARDS,
} from "@/lib/seo/popular-search-gate";

/** Fabrique une venue groupable à des coords distinctes par défaut. */
const v = (
  id: string,
  name: string,
  opts: Partial<{ lat: number; lon: number; sport: string }> = {},
) => ({
  id,
  name,
  lat: opts.lat ?? 48.85 + Number(id) * 0.01,
  lon: opts.lon ?? 2.35 + Number(id) * 0.01,
  primary_sport_slug: opts.sport ?? "padel",
  courts_count: 1,
});

describe("highConfidenceCardCount", () => {
  it("collapse les court-level (pattern /padel/fr/paris) → faible compte", () => {
    // Mêmes coords : ce sont les pistes d'UN club + le générique voisin.
    const co = { lat: 48.85, lon: 2.35 };
    const rows = [
      v("1", "Sportfield 16 piste 1", co),
      v("2", "Sportfield 16 piste 2", co),
      v("3", "Sportfield 16 piste 3", co),
      v("4", "COURT DE PADEL", co),
    ];
    // 4 enregistrements court-level → 1 seule card de club.
    expect(highConfidenceCardCount(rows, "padel")).toBe(1);
    expect(isPopularSearchEligible(rows, "padel")).toBe(false);
  });

  it("liste propre de 5 vrais lieux distincts → éligible", () => {
    const rows = [
      v("1", "Padel Club République"),
      v("2", "All In Padel"),
      v("3", "Casa Padel"),
      v("4", "4Padel Paris"),
      v("5", "Le Five Padel"),
    ];
    expect(highConfidenceCardCount(rows, "padel")).toBe(5);
    expect(isPopularSearchEligible(rows, "padel")).toBe(true);
  });

  it("exclut les noms contredisant le sport (#553)", () => {
    const rows = [
      v("1", "Tennis Club de Lyon", { sport: "tennis" }),
      v("2", "Tennis Park Gerland", { sport: "tennis" }),
      v("3", "Piscine de Vaise", { sport: "tennis" }), // mismatch → exclu
      v("4", "Boulodrome municipal", { sport: "tennis" }), // mismatch → exclu
    ];
    // 4 lieux, 2 contradictoires exclus → 2 cards.
    expect(highConfidenceCardCount(rows, "tennis")).toBe(2);
    expect(isPopularSearchEligible(rows, "tennis")).toBe(false);
  });

  it("juste au seuil : exactement 5 → éligible, 4 → non", () => {
    const five = Array.from({ length: 5 }, (_, i) => v(String(i + 1), `Club ${i + 1}`));
    const four = five.slice(0, 4);
    expect(isPopularSearchEligible(five, "padel")).toBe(true);
    expect(isPopularSearchEligible(four, "padel")).toBe(false);
  });

  it("liste vide → 0, non éligible", () => {
    expect(highConfidenceCardCount([], "tennis")).toBe(0);
    expect(isPopularSearchEligible([], "tennis")).toBe(false);
  });

  it("seuil par défaut = 5", () => {
    expect(MIN_HIGH_CONFIDENCE_CARDS).toBe(5);
  });
});
