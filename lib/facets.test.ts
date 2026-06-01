import { describe, expect, it } from "vitest";
import { mergeFacets, pivotFacets, type FacetRow } from "./facets";

describe("pivotFacets", () => {
  it("range chaque ligne dans la map de son type", () => {
    const rows: FacetRow[] = [
      { facet_type: "family", facet_key: "raquette", n: 12 },
      { facet_type: "family", facet_key: "ballon", n: 5 },
      { facet_type: "criteria", facet_key: "lit", n: 3 },
      { facet_type: "surface", facet_key: "clay", n: 7 },
    ];
    expect(pivotFacets(rows)).toEqual({
      family: { raquette: 12, ballon: 5 },
      criteria: { lit: 3 },
      surface: { clay: 7 },
    });
  });

  it("retourne 3 maps vides pour une entrée vide", () => {
    expect(pivotFacets([])).toEqual({ family: {}, criteria: {}, surface: {} });
  });

  it("coerce n en number (la RPC peut renvoyer BIGINT en string)", () => {
    const rows = [{ facet_type: "family", facet_key: "raquette", n: "42" as unknown as number }];
    expect(pivotFacets(rows).family.raquette).toBe(42);
  });

  it("ignore un facet_type inconnu (robustesse évolution RPC)", () => {
    const rows: FacetRow[] = [
      { facet_type: "mystery", facet_key: "x", n: 9 },
      { facet_type: "family", facet_key: "yoga", n: 1 },
    ];
    const out = pivotFacets(rows);
    expect(out.family).toEqual({ yoga: 1 });
    expect(out.criteria).toEqual({});
    expect(out.surface).toEqual({});
  });
});

describe("mergeFacets", () => {
  it("additionne les n par (facet_type, facet_key)", () => {
    const a: FacetRow[] = [
      { facet_type: "family", facet_key: "raquette", n: 10 },
      { facet_type: "surface", facet_key: "clay", n: 2 },
    ];
    const b: FacetRow[] = [
      { facet_type: "family", facet_key: "raquette", n: 5 },
      { facet_type: "family", facet_key: "ballon", n: 3 },
    ];
    const merged = mergeFacets(a, b);
    const byKey = Object.fromEntries(merged.map((r) => [`${r.facet_type}|${r.facet_key}`, r.n]));
    expect(byKey["family|raquette"]).toBe(15);
    expect(byKey["family|ballon"]).toBe(3);
    expect(byKey["surface|clay"]).toBe(2);
  });

  it("ne distingue pas une même clé de types différents", () => {
    // 'free' existe en criteria ; un hypothétique surface 'free' resterait distinct.
    const a: FacetRow[] = [{ facet_type: "criteria", facet_key: "free", n: 4 }];
    const b: FacetRow[] = [{ facet_type: "surface", facet_key: "free", n: 1 }];
    const merged = mergeFacets(a, b);
    expect(merged).toHaveLength(2);
  });

  it("ne mute pas les entrées d'origine", () => {
    const a: FacetRow[] = [{ facet_type: "family", facet_key: "raquette", n: 10 }];
    const b: FacetRow[] = [{ facet_type: "family", facet_key: "raquette", n: 5 }];
    mergeFacets(a, b);
    expect(a[0].n).toBe(10);
    expect(b[0].n).toBe(5);
  });

  it("gère les listes vides", () => {
    expect(mergeFacets([], [])).toEqual([]);
  });
});
