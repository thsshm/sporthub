import { describe, expect, it } from "vitest";
import { SAFE_LAT, SAFE_LON, parseBboxParam } from "@/lib/bbox";

describe("parseBboxParam — erreurs", () => {
  it("retourne erreur sur input null", () => {
    const r = parseBboxParam(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/required/);
  });

  it("retourne erreur sur input vide", () => {
    const r = parseBboxParam("");
    expect(r.ok).toBe(false);
  });

  it("retourne erreur si moins de 4 nombres", () => {
    const r = parseBboxParam("1,2,3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/4 numbers/);
  });

  it("retourne erreur sur NaN dans le tuple", () => {
    const r = parseBboxParam("1,foo,3,4");
    expect(r.ok).toBe(false);
  });

  it("retourne erreur si south >= north", () => {
    const r = parseBboxParam("0,10,10,5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/south<north/);
  });

  it("retourne erreur si south === north", () => {
    const r = parseBboxParam("0,10,10,10");
    expect(r.ok).toBe(false);
  });
});

describe("parseBboxParam — cas normaux", () => {
  it("accepte une bbox Paris valide", () => {
    const r = parseBboxParam("2.20,48.80,2.45,48.92");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBeCloseTo(2.2);
      expect(r.bbox.east).toBeCloseTo(2.45);
      expect(r.bbox.south).toBeCloseTo(48.8);
      expect(r.bbox.north).toBeCloseTo(48.92);
    }
  });

  it("accepte une bbox Europe élargie", () => {
    const r = parseBboxParam("-10,35,20,55");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBe(-10);
      expect(r.bbox.east).toBe(20);
    }
  });
});

describe("parseBboxParam — clamp PostGIS safe", () => {
  it("clamp west=-180 → -179.9 (évite antipodal edge)", () => {
    const r = parseBboxParam("-180,-90,180,90");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBe(-SAFE_LON);
      expect(r.bbox.east).toBe(SAFE_LON);
      expect(r.bbox.south).toBe(-SAFE_LAT);
      expect(r.bbox.north).toBe(SAFE_LAT);
    }
  });

  it("clamp longitudes > 180", () => {
    const r = parseBboxParam("-200,-50,200,50");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBe(-SAFE_LON);
      expect(r.bbox.east).toBe(SAFE_LON);
    }
  });

  it("clamp latitudes au-delà des pôles", () => {
    const r = parseBboxParam("0,-100,10,100");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.south).toBe(-SAFE_LAT);
      expect(r.bbox.north).toBe(SAFE_LAT);
    }
  });

  it("ne touche pas une bbox à l'intérieur des bornes safe", () => {
    const r = parseBboxParam("100,-30,170,30");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBe(100);
      expect(r.bbox.east).toBe(170);
    }
  });
});

describe("parseBboxParam — antiméridien (Pacifique)", () => {
  it("west=170, east=-170 → bbox monde entier en longitude", () => {
    const r = parseBboxParam("170,-10,-170,10");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Pas d'erreur, et substitué par une bbox monde
      expect(r.bbox.west).toBe(-SAFE_LON);
      expect(r.bbox.east).toBe(SAFE_LON);
      // Lats préservées
      expect(r.bbox.south).toBe(-10);
      expect(r.bbox.north).toBe(10);
    }
  });

  it("west=179.5, east=-179.5 → géré sans erreur", () => {
    const r = parseBboxParam("179.5,-5,-179.5,5");
    expect(r.ok).toBe(true);
  });

  it("west === east (cas dégénéré) → traité comme antiméridien", () => {
    // west=east signifie 0 largeur en longitude — pas un cas réel mais le
    // parseur ne doit pas planter. Notre règle west>east substitue monde.
    // west===east échappe à cette règle et est accepté tel quel.
    const r = parseBboxParam("10,-5,10,5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bbox.west).toBe(10);
      expect(r.bbox.east).toBe(10);
    }
  });
});
