import { describe, expect, it } from "vitest";
import { parseBbox, roundBbox } from "@/lib/bbox";

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

describe("roundBbox — arrondi à 0.01° pour cache key CDN", () => {
  it("arrondit une bbox normale à 0.01°", () => {
    const parsed = parseBbox("2.2873,48.8219,2.4123,48.9012");
    if (parsed.kind !== "normal") throw new Error("expected normal");
    const r = roundBbox(parsed);
    expect(r.kind).toBe("normal");
    if (r.kind === "normal") {
      expect(r.west).toBe(2.29);
      expect(r.south).toBe(48.82);
      expect(r.east).toBe(2.41);
      expect(r.north).toBe(48.9);
    }
  });

  it("retourne le même résultat pour deux bbox tombant sur la même cellule 0.01°", () => {
    // Deux viewports légèrement décalés mais arrondis au même 0.01° → CDN HIT.
    // NB: l'arrondi est `Math.round(n * 100) / 100` (cf. issue #113) ; toute
    // paire de bbox dont les 4 coords sont strictement dans la même cellule
    // 0.01° (delta < 0.005 de chaque côté du centre de cellule) HIT le même
    // cache. Pour des bbox tirées au hasard à ≤1 km de distance, le HIT n'est
    // pas garanti à 100 % (cas frontalier), mais le ratio statistique reste
    // largement supérieur au sans-arrondi.
    const a = parseBbox("2.2812,48.8211,2.4112,48.9011");
    const b = parseBbox("2.2848,48.8245,2.4148,48.9045");
    if (a.kind !== "normal" || b.kind !== "normal") throw new Error("expected normal");
    const ra = roundBbox(a);
    const rb = roundBbox(b);
    expect(ra).toEqual(rb);
  });

  it("conserve kind=global tel quel (rien à arrondir)", () => {
    const parsed = parseBbox("-180,-90,180,90");
    if (parsed.kind !== "global") throw new Error("expected global");
    const r = roundBbox(parsed);
    expect(r.kind).toBe("global");
  });

  it("arrondit une bbox antimeridian sur ses 4 lon + 2 lat", () => {
    const parsed = parseBbox("170.123,-10.456,-170.789,10.321");
    if (parsed.kind !== "antimeridian") throw new Error("expected antimeridian");
    const r = roundBbox(parsed);
    expect(r.kind).toBe("antimeridian");
    if (r.kind === "antimeridian") {
      expect(r.west1).toBe(170.12);
      expect(r.east1).toBe(179.9); // déjà clampé, arrondi exact
      expect(r.west2).toBe(-179.9);
      expect(r.east2).toBe(-170.79);
      expect(r.south).toBe(-10.46);
      expect(r.north).toBe(10.32);
    }
  });
});
