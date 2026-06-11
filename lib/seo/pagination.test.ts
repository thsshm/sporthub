import { describe, expect, it } from "vitest";
import { cityPageHref, parsePageSegment } from "./pagination";

describe("cityPageHref", () => {
  it("page 1 → chemin canonique sans suffixe", () => {
    expect(cityPageHref("/tennis/fr/lyon", 1)).toBe("/tennis/fr/lyon");
    expect(cityPageHref("/tennis/fr/lyon", 0)).toBe("/tennis/fr/lyon");
  });
  it("pages 2+ → segment /page/N", () => {
    expect(cityPageHref("/tennis/fr/lyon", 2)).toBe("/tennis/fr/lyon/page/2");
    expect(cityPageHref("/gym/fr/paris", 12)).toBe("/gym/fr/paris/page/12");
  });
  it("normalise le slash final", () => {
    expect(cityPageHref("/tennis/fr/lyon/", 2)).toBe("/tennis/fr/lyon/page/2");
    expect(cityPageHref("/tennis/fr/lyon/", 1)).toBe("/tennis/fr/lyon");
  });
});

describe("parsePageSegment", () => {
  it("accepte les entiers ≥ 1", () => {
    expect(parsePageSegment("1")).toBe(1);
    expect(parsePageSegment("42")).toBe(42);
  });
  it("rejette tout le reste (→ null → 404)", () => {
    expect(parsePageSegment("0")).toBeNull();
    expect(parsePageSegment("-3")).toBeNull();
    expect(parsePageSegment("2.5")).toBeNull();
    expect(parsePageSegment("abc")).toBeNull();
    expect(parsePageSegment("")).toBeNull();
    expect(parsePageSegment("1e3")).toBeNull();
    expect(parsePageSegment(" 2")).toBeNull();
  });
});
