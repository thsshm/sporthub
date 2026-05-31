import { describe, expect, it } from "vitest";
import { getEmptyState } from "./empty-state";

describe("getEmptyState", () => {
  it("retourne null dès qu'il y a au moins un résultat", () => {
    expect(getEmptyState({ count: 1, zoom: 10 })).toBeNull();
    expect(getEmptyState({ count: 250, zoom: 2 })).toBeNull();
  });

  describe("zoom trop bas (< 4)", () => {
    it("détecte la vue planétaire", () => {
      const r = getEmptyState({ count: 0, zoom: 3 });
      expect(r?.kind).toBe("empty_zoom_too_low");
      expect(r?.titleKey).toBe("zoomTooLowTitle");
      expect(r?.descriptionKey).toBe("zoomTooLowDescription");
    });

    it("zoom = 4 n'est PAS trop bas (frontière exclusive)", () => {
      // zoom 4 tombe dans le cas générique (pas < 4, pas > 14, pas de filtre).
      expect(getEmptyState({ count: 0, zoom: 4 })?.kind).toBe("empty_generic");
    });

    it("le zoom trop bas prime sur les filtres actifs", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 2,
        selectedCriteria: new Set(["lit"]),
      });
      expect(r?.kind).toBe("empty_zoom_too_low");
    });
  });

  describe("zoom trop haut (> 14)", () => {
    it("détecte le sur-zoom", () => {
      const r = getEmptyState({ count: 0, zoom: 16 });
      expect(r?.kind).toBe("empty_zoom_too_high");
      expect(r?.titleKey).toBe("zoomTooHighTitle");
    });

    it("zoom = 14 n'est PAS trop haut (frontière exclusive)", () => {
      expect(getEmptyState({ count: 0, zoom: 14 })?.kind).toBe("empty_generic");
    });
  });

  describe("filtres actifs (zoom dans la plage 4..14)", () => {
    it("familles partielles → empty_filters", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 10,
        selectedFamilies: new Set(["raquette"]),
        totalFamilies: 13,
      });
      expect(r?.kind).toBe("empty_filters");
      expect(r?.titleKey).toBe("filtersEmptyTitle");
    });

    it("toutes les familles cochées = PAS un filtre → générique", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 10,
        selectedFamilies: new Set(["a", "b", "c"]),
        totalFamilies: 3,
      });
      expect(r?.kind).toBe("empty_generic");
    });

    it("aucune famille cochée (size 0) → pas un filtre famille", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 10,
        selectedFamilies: new Set(),
        totalFamilies: 13,
      });
      expect(r?.kind).toBe("empty_generic");
    });

    it("critères universels cochés → empty_filters", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 8,
        selectedCriteria: new Set(["wheelchair", "indoor"]),
      });
      expect(r?.kind).toBe("empty_filters");
    });

    it("familles partielles OU critères → empty_filters (OR logique)", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 8,
        selectedFamilies: new Set(["a", "b", "c"]),
        totalFamilies: 3, // pas un filtre famille…
        selectedCriteria: new Set(["lit"]), // …mais critère actif
      });
      expect(r?.kind).toBe("empty_filters");
    });
  });

  describe("fallback générique", () => {
    it("zone vide sans filtre dans la plage de zoom normale", () => {
      const r = getEmptyState({ count: 0, zoom: 10 });
      expect(r?.kind).toBe("empty_generic");
      expect(r?.titleKey).toBe("genericTitle");
      expect(r?.descriptionKey).toBe("genericDescription");
    });

    it("filtres absents (undefined) → générique", () => {
      const r = getEmptyState({
        count: 0,
        zoom: 10,
        selectedFamilies: undefined,
        selectedCriteria: undefined,
      });
      expect(r?.kind).toBe("empty_generic");
    });
  });
});
