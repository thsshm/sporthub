import { describe, it, expect } from "vitest";
import { telHref } from "./cta";

describe("telHref", () => {
  it("retire espaces et séparateurs en gardant le + initial", () => {
    expect(telHref("+33 1 02 03 04 05")).toBe("tel:+33102030405");
    expect(telHref("01.02.03.04.05")).toBe("tel:0102030405");
    expect(telHref("(0)1 02-03-04-05")).toBe("tel:0102030405");
  });

  it("retourne null pour vide / null / undefined", () => {
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
  });

  it("retourne null si aucun chiffre (donnée corrompue)", () => {
    expect(telHref("+")).toBeNull();
    expect(telHref("n/a")).toBeNull();
  });
});
