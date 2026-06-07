import { describe, expect, it } from "vitest";
import { generateVenueDescription } from "./description";
import type { DescriptionContext, DescriptionStrings } from "./description";

const FR: DescriptionStrings = {
  venueType: "court de tennis",
  indoor: "Intérieur",
  outdoor: "Extérieur",
  inCity: "à",
  courtsPattern: "{n} terrains",
  lit: "éclairé",
  freeAccess: "accès libre",
  paidAccess: "payant",
};

const EN: DescriptionStrings = {
  venueType: "tennis court",
  indoor: "Indoor",
  outdoor: "Outdoor",
  inCity: "in",
  courtsPattern: "{n} courts",
  lit: "lit",
  freeAccess: "free access",
  paidAccess: "paid",
};

const baseCtx: DescriptionContext = {
  sportName: "tennis",
  cityName: "Blagnac",
  countryCode: "FR",
  courtsCount: null,
  isIndoor: null,
  hasLighting: null,
  feeRequired: null,
};

describe("generateVenueDescription", () => {
  it("génère une description minimale (FR)", () => {
    const r = generateVenueDescription(baseCtx, FR);
    expect(r).toContain("court de tennis");
    expect(r).toContain("Blagnac");
    expect(r).toContain("FR");
    expect(r!.endsWith(".")).toBe(true);
  });

  it("ajoute indoor/outdoor (EN)", () => {
    const r = generateVenueDescription({ ...baseCtx, isIndoor: false }, EN);
    expect(r).toContain("Outdoor tennis court");
  });

  it("ajoute le nombre de courts si > 1", () => {
    const r = generateVenueDescription({ ...baseCtx, courtsCount: 16 }, FR);
    expect(r).toContain("16 terrains");
  });

  it("n'affiche pas les courts si count = 1", () => {
    const r = generateVenueDescription({ ...baseCtx, courtsCount: 1 }, FR);
    expect(r).not.toContain("terrain");
  });

  it("ajoute éclairage", () => {
    const r = generateVenueDescription({ ...baseCtx, hasLighting: true }, FR);
    expect(r).toContain("éclairé");
  });

  it("ajoute accès libre", () => {
    const r = generateVenueDescription({ ...baseCtx, feeRequired: false }, FR);
    expect(r).toContain("accès libre");
  });

  it("ajoute payant si feeRequired=true", () => {
    const r = generateVenueDescription({ ...baseCtx, feeRequired: true }, EN);
    expect(r).toContain("paid");
  });

  it("retourne null si contexte vide et venueType vide", () => {
    const r = generateVenueDescription(
      { ...baseCtx, sportName: null, cityName: null },
      { ...FR, venueType: "" },
    );
    expect(r).toBeNull();
  });

  it("combinaison complète (EN)", () => {
    const r = generateVenueDescription(
      { ...baseCtx, isIndoor: true, courtsCount: 4, hasLighting: true, feeRequired: false },
      EN,
    );
    expect(r).toContain("Indoor tennis court");
    expect(r).toContain("Blagnac");
    expect(r).toContain("4 courts");
    expect(r).toContain("lit");
    expect(r).toContain("free access");
  });
});
