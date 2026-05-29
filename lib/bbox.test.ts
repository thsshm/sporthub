import { describe, expect, it } from "vitest";
import { parseBbox } from "@/lib/bbox";

describe("parseBbox — validation d'entrée", () => {
  it("rejette une bbox vide", () => {
    const r = parseBbox("");
    expect(r.kind).toBe("error");
  });

  it("rejette une bbox avec moins de 4 valeurs", () => {
    const r = parseBbox("1,2,3");
    expect(r.kind).toBe("error");
  });

  it("rejette une bbox avec plus de 4 valeurs", () => {
    const r = parseBbox("1,2,3,4,5");
    expect(r.kind).toBe("error");
  });

  it("rejette une bbox avec une valeur non-numérique", () => {
    const r = parseBbox("foo,2,3,4");
    expect(r.kind).toBe("error");
  });

  it("rejette les valeurs non-finies (Infinity, -Infinity)", () => {
    // Number.isNaN(Infinity) === false, donc une validation purement isNaN
    // laisserait passer ces valeurs et produirait une bbox dégénérée côté SQL.
    expect(parseBbox("Infinity,-90,180,90").kind).toBe("error");
    expect(parseBbox("-180,-Infinity,180,90").kind).toBe("error");
    expect(parseBbox("-180,-90,Infinity,90").kind).toBe("error");
  });

  it("rejette une bbox où south >= north", () => {
    const r = parseBbox("0,10,10,10");
    expect(r.kind).toBe("error");
    const r2 = parseBbox("0,20,10,10");
    expect(r2.kind).toBe("error");
  });

  it("rejette une bbox de largeur nulle (west == east)", () => {
    const r = parseBbox("5,0,5,10");
    expect(r.kind).toBe("error");
  });
});

describe("parseBbox — bbox normale (cas Paris/Europe)", () => {
  it("retourne kind=normal pour une bbox Paris", () => {
    // Paris centré, vue zoomée moyenne
    const r = parseBbox("2.2,48.8,2.5,48.9");
    expect(r.kind).toBe("normal");
    if (r.kind === "normal") {
      expect(r.west).toBeCloseTo(2.2);
      expect(r.south).toBeCloseTo(48.8);
      expect(r.east).toBeCloseTo(2.5);
      expect(r.north).toBeCloseTo(48.9);
    }
  });

  it("retourne kind=normal pour une bbox Europe", () => {
    const r = parseBbox("-10,35,30,60");
    expect(r.kind).toBe("normal");
    if (r.kind === "normal") {
      expect(r.west).toBe(-10);
      expect(r.east).toBe(30);
    }
  });

  it("clamp les valeurs proches de ±180/±90 pour éviter l'erreur antipodale", () => {
    // Bbox quasi-mondiale en lon mais pas en lat → reste "normal" mais doit être clampée
    const r = parseBbox("-180,40,180,50");
    // lonSpan=360 ≥ 350 mais latSpan=10 < 170 → pas "global", reste "normal" clampé
    expect(r.kind).toBe("normal");
    if (r.kind === "normal") {
      expect(r.west).toBeGreaterThan(-180);
      expect(r.east).toBeLessThan(180);
    }
  });
});

describe("parseBbox — bbox mondiale (cas premier rendu MapLibre)", () => {
  it("retourne kind=global pour -180,-90,180,90 (le cas du bug #101)", () => {
    const r = parseBbox("-180,-90,180,90");
    expect(r.kind).toBe("global");
  });

  it("retourne kind=global pour une bbox quasi-mondiale", () => {
    const r = parseBbox("-179,-89,179,89");
    expect(r.kind).toBe("global");
  });

  it("ne déclenche PAS global si seule la lon couvre tout (vue zoomée en latitude)", () => {
    // lonSpan=360 mais latSpan=20 → pas global, c'est une bbox étirée horizontalement
    const r = parseBbox("-180,40,180,60");
    expect(r.kind).not.toBe("global");
  });
});

describe("parseBbox — bbox antiméridien (cas Pacifique)", () => {
  it("retourne kind=antimeridian quand west > east", () => {
    // Bbox Pacifique : du Japon (~170°E) aux îles Aléoutiennes (~-170°)
    const r = parseBbox("170,-10,-170,10");
    expect(r.kind).toBe("antimeridian");
    if (r.kind === "antimeridian") {
      // Moitié ouest : [170, ~180]
      expect(r.west1).toBeCloseTo(170);
      expect(r.east1).toBeGreaterThan(179);
      expect(r.east1).toBeLessThan(180);
      // Moitié est : [~-180, -170]
      expect(r.west2).toBeGreaterThan(-180);
      expect(r.west2).toBeLessThan(-179);
      expect(r.east2).toBeCloseTo(-170);
      // Lat préservée
      expect(r.south).toBeCloseTo(-10);
      expect(r.north).toBeCloseTo(10);
    }
  });

  it("gère un autre cas antiméridien (Hawaii vers Fidji)", () => {
    const r = parseBbox("160,-20,-150,30");
    expect(r.kind).toBe("antimeridian");
    if (r.kind === "antimeridian") {
      expect(r.west1).toBeCloseTo(160);
      expect(r.east2).toBeCloseTo(-150);
    }
  });
});

describe("parseBbox — clamping aux pôles", () => {
  it("clamp la latitude à ±89.9", () => {
    const r = parseBbox("0,-90,10,90");
    expect(r.kind).toBe("normal");
    if (r.kind === "normal") {
      expect(r.south).toBeGreaterThan(-90);
      expect(r.north).toBeLessThan(90);
      expect(r.south).toBeCloseTo(-89.9);
      expect(r.north).toBeCloseTo(89.9);
    }
  });
});
