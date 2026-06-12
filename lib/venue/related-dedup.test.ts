import { describe, it, expect } from "vitest";
import {
  normalizeVenueName,
  haversineMeters,
  dedupeRelatedVenues,
} from "./related-dedup";

describe("normalizeVenueName", () => {
  it("ignore casse, accents et ponctuation", () => {
    expect(normalizeVenueName("Tennis Club de Gerland")).toBe(
      "tennis club de gerland",
    );
    expect(normalizeVenueName("Tennis-Club  DE Gérland")).toBe(
      normalizeVenueName("Tennis Club de Gerland"),
    );
  });

  it("gère null/vide", () => {
    expect(normalizeVenueName("")).toBe("");
    // @ts-expect-error robustesse runtime
    expect(normalizeVenueName(undefined)).toBe("");
  });
});

describe("haversineMeters", () => {
  it("0 pour le même point, ~111 km par degré de latitude", () => {
    expect(haversineMeters(45.75, 4.85, 45.75, 4.85)).toBe(0);
    expect(Math.abs(haversineMeters(45, 4, 46, 4) - 111_195)).toBeLessThan(500);
  });
});

describe("dedupeRelatedVenues (#657)", () => {
  const mk = (name: string, lat: number, lon: number, id: string) => ({
    id,
    name,
    lat,
    lon,
  });

  it("supprime un même lieu en double (nom + coords proches)", () => {
    const rows = [
      mk("Tennis Club de Lyon", 45.7505, 4.8505, "a"),
      mk("Tennis Club de Lyon", 45.7506, 4.8506, "b"), // ~15 m → doublon
      mk("Tennis Club de Gerland", 45.72, 4.83, "c"),
    ];
    const out = dedupeRelatedVenues(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("garde deux clubs de même nom mais éloignés (réellement distincts)", () => {
    const rows = [
      mk("Tennis Club", 45.75, 4.85, "a"),
      mk("Tennis Club", 48.85, 2.35, "b"), // Paris vs Lyon → distincts
    ];
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("traite accents/casse comme identiques", () => {
    const rows = [
      mk("Tennis Club de Gérland", 45.72, 4.83, "a"),
      mk("tennis club de gerland", 45.7201, 4.8301, "b"),
    ];
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("préserve l'ordre et les noms distincts", () => {
    const rows = [
      mk("Padel A", 45.75, 4.85, "a"),
      mk("Padel B", 45.7501, 4.8501, "b"),
    ];
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  // Cas de l'issue #698 (listes SEO sport×ville / sport global).
  it("#698 CrossFit Louvre / Crossfit Louvre (même lieu, casse) → 1 card", () => {
    const rows = [
      mk("CrossFit Louvre", 48.8606, 2.3376, "a"),
      mk("Crossfit Louvre", 48.8607, 2.3377, "b"),
    ];
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("#698 « The Padellers » répété au même endroit → 1 card", () => {
    const rows = [
      mk("The Padellers Amsterdam", 52.37, 4.89, "a"),
      mk("The Padellers Amsterdam", 52.3701, 4.8901, "b"),
      mk("The Padellers Amsterdam", 52.3702, 4.8902, "c"),
    ];
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("#698 branches Basic-Fit distinctes (> 250 m) → gardées séparées", () => {
    const rows = [
      mk("Basic-Fit", 48.8566, 2.3522, "a"), // Paris centre
      mk("Basic-Fit", 48.8744, 2.295, "b"), // ~1,5 km plus loin
      mk("Basic-Fit", 48.8499, 2.379, "c"), // ~3 km
    ];
    // Même nom mais coords éloignées → branches réelles, aucune fusion.
    expect(dedupeRelatedVenues(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
