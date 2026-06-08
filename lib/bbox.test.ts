import { describe, expect, it } from "vitest";
import { parseBbox, snapBboxMax, snapBboxMin } from "@/lib/bbox";

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

describe("snapBboxMin / snapBboxMax — snap directionnel anti-collapse (#442)", () => {
  it("snapBboxMin floore sur la grille 0.01°", () => {
    expect(snapBboxMin(2.3515)).toBeCloseTo(2.35, 5);
    expect(snapBboxMin(2.3599)).toBeCloseTo(2.35, 5);
    // Négatif : floor descend vers -∞ → 2.341 → 2.34.
    expect(snapBboxMin(-2.341)).toBeCloseTo(-2.35, 5);
  });

  it("snapBboxMax ceile sur la grille 0.01°", () => {
    expect(snapBboxMax(2.3501)).toBeCloseTo(2.36, 5);
    expect(snapBboxMax(2.3529)).toBeCloseTo(2.36, 5);
    expect(snapBboxMax(-2.349)).toBeCloseTo(-2.34, 5);
  });

  it("préserve une valeur déjà sur la grille", () => {
    expect(snapBboxMin(2.35)).toBeCloseTo(2.35, 5);
    expect(snapBboxMax(2.35)).toBeCloseTo(2.35, 5);
  });

  it("GARANTIT une largeur snappée ≥ 0.01° même sur une bbox ultra-étroite (cœur du bug)", () => {
    // À zoom ≥ 16 sur Paris (lon 2.3522), la vue fait < 0.01° de large.
    // Math.round symétrique collait west et east sur 2.35 → enveloppe d'aire
    // nulle → 0 venue. Le snap directionnel garde la box ouverte.
    const west = 2.35205;
    const east = 2.35235; // span réel ~0.0003°
    const sw = snapBboxMin(west);
    const se = snapBboxMax(east);
    expect(se - sw).toBeGreaterThanOrEqual(0.01 - 1e-9);
    // La box snappée contient bien la vue réelle (jamais de rétrécissement).
    expect(sw).toBeLessThanOrEqual(west);
    expect(se).toBeGreaterThanOrEqual(east);
  });

  it("ne s'effondre jamais sur 1000 fenêtres étroites balayant la grille", () => {
    for (let i = 0; i < 1000; i++) {
      const center = -180 + i * 0.36; // balaie tout le globe
      const west = center - 0.0001;
      const east = center + 0.0001;
      const sw = snapBboxMin(west);
      const se = snapBboxMax(east);
      expect(se).toBeGreaterThan(sw); // jamais d'aire nulle
      expect(sw).toBeLessThanOrEqual(west);
      expect(se).toBeGreaterThanOrEqual(east);
    }
  });
});
