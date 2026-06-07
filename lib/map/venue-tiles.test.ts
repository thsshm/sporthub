import { describe, it, expect } from "vitest";
import {
  buildCircleRadiusExpression,
  buildFamilyColorExpression,
  buildFamilyFilter,
  venueTilesFilter,
  pmtilesSourceUrl,
  FALLBACK_COLOR,
} from "./venue-tiles";
import { FAMILIES } from "@/lib/families";

describe("venue-tiles", () => {
  it("buildFamilyColorExpression : match + une paire (slug, couleur) par famille + fallback", () => {
    const expr = buildFamilyColorExpression() as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr[1]).toEqual(["get", "fam"]);
    // 2 (match + get) + 2*N (paires slug/couleur) + 1 (fallback)
    expect(expr.length).toBe(2 + FAMILIES.length * 2 + 1);
    expect(expr[expr.length - 1]).toBe(FALLBACK_COLOR);
    // Chaque famille connue est mappée à une couleur (string non vide).
    const i = expr.indexOf("raquette");
    expect(i).toBeGreaterThan(1);
    expect(typeof expr[i + 1]).toBe("string");
    expect((expr[i + 1] as string).length).toBeGreaterThan(0);
  });

  it("buildCircleRadiusExpression : interpolate linéaire sur le zoom", () => {
    const expr = buildCircleRadiusExpression() as unknown[];
    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["zoom"]);
  });

  it("buildFamilyFilter : undefined quand pas de sous-ensemble strict", () => {
    expect(buildFamilyFilter(undefined, 13)).toBeUndefined();
    expect(buildFamilyFilter(new Set<string>(), 13)).toBeUndefined();
    // toutes cochées (size >= total) → pas de filtre
    expect(buildFamilyFilter(new Set(["a", "b"]), 2)).toBeUndefined();
    // total inconnu → pas de filtre
    expect(buildFamilyFilter(new Set(["a"]), undefined)).toBeUndefined();
  });

  it("buildFamilyFilter : expression `in` sur fam quand sous-ensemble strict", () => {
    const f = buildFamilyFilter(new Set(["raquette", "ballon"]), 13) as unknown[];
    expect(f[0]).toBe("in");
    expect(f[1]).toEqual(["get", "fam"]);
    expect(f[2]).toEqual(["literal", ["raquette", "ballon"]]);
  });

  // Régression #226 : MapLibre addLayer rejette `filter: undefined` (carte
  // blanche). venueTilesFilter doit TOUJOURS renvoyer un tableau valide.
  it("venueTilesFilter : jamais undefined — ['all'] quand pas de sous-ensemble", () => {
    expect(venueTilesFilter(undefined, 13)).toEqual(["all"]);
    expect(venueTilesFilter(new Set<string>(), 13)).toEqual(["all"]);
    expect(venueTilesFilter(new Set(["a", "b"]), 2)).toEqual(["all"]);
    expect(venueTilesFilter(new Set(["a"]), undefined)).toEqual(["all"]);
  });

  it("venueTilesFilter : délègue à buildFamilyFilter quand sous-ensemble strict", () => {
    const f = venueTilesFilter(new Set(["raquette", "ballon"]), 13) as unknown[];
    expect(f[0]).toBe("in");
    expect(f[2]).toEqual(["literal", ["raquette", "ballon"]]);
  });

  it("pmtilesSourceUrl : préfixe pmtiles://", () => {
    expect(pmtilesSourceUrl("https://x.supabase.co/venues.pmtiles")).toBe(
      "pmtiles://https://x.supabase.co/venues.pmtiles",
    );
  });
});
