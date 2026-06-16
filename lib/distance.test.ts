import { describe, expect, it } from "vitest";
import { distanceMeters, formatDistance } from "@/lib/distance";

describe("distanceMeters (#703)", () => {
  it("0 pour deux points identiques", () => {
    expect(distanceMeters(48.85, 2.35, 48.85, 2.35)).toBe(0);
  });
  it("~111 km pour 1° de latitude", () => {
    expect(Math.round(distanceMeters(0, 0, 1, 0) / 1000)).toBe(111);
  });
  it("symétrique", () => {
    expect(distanceMeters(48, 2, 49, 3)).toBeCloseTo(distanceMeters(49, 3, 48, 2), 6);
  });
  it("distance courte plausible (Tour Eiffel → Louvre ≈ 3,5 km)", () => {
    const d = distanceMeters(48.8584, 2.2945, 48.8606, 2.3376);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(4000);
  });
});

describe("formatDistance (#703)", () => {
  it("sous 1 km → mètres arrondis à 50 m", () => {
    expect(formatDistance(842)).toBe("~850 m");
    expect(formatDistance(120)).toBe("~100 m");
    expect(formatDistance(10)).toBe("~50 m"); // plancher 50 m
  });
  it("1 décimale sous 10 km, entier au-delà", () => {
    expect(formatDistance(2340, "fr")).toBe("~2,3 km");
    expect(formatDistance(2340, "en")).toBe("~2.3 km");
    expect(formatDistance(23400, "fr")).toBe("~23 km");
  });
  it("valeur invalide → chaîne vide", () => {
    expect(formatDistance(NaN)).toBe("");
    expect(formatDistance(-5)).toBe("");
  });
});
