import { describe, expect, it } from "vitest";
import {
  getCourtCountDisplay,
  isGenericEquipmentName,
  plausibleCourtCount,
} from "@/lib/venue/courts-plausibility";

describe("plausibleCourtCount", () => {
  it("garde une valeur plausible", () => {
    expect(plausibleCourtCount(8, "raquette")).toBe(8);
    expect(plausibleCourtCount(30, "raquette")).toBe(30);
    expect(plausibleCourtCount(1, "ballon")).toBe(1);
  });

  it("masque une valeur aberrante (au-dessus du seuil famille)", () => {
    expect(plausibleCourtCount(200, "raquette")).toBeNull();
    expect(plausibleCourtCount(45, "raquette")).toBeNull(); // > 40
    expect(plausibleCourtCount(35, "ballon")).toBeNull(); // > 30
  });

  it("respecte le seuil par défaut pour une famille inconnue", () => {
    expect(plausibleCourtCount(50, "famille_x")).toBe(50);
    expect(plausibleCourtCount(51, "famille_x")).toBeNull();
    expect(plausibleCourtCount(50, null)).toBe(50);
  });

  it("null/0/négatif → null (rien à afficher)", () => {
    expect(plausibleCourtCount(0, "raquette")).toBeNull();
    expect(plausibleCourtCount(null, "raquette")).toBeNull();
    expect(plausibleCourtCount(undefined, "raquette")).toBeNull();
    expect(plausibleCourtCount(-3, "raquette")).toBeNull();
  });

  it("accepte un sportSlug optionnel pour affiner (#636)", () => {
    expect(plausibleCourtCount(20, "raquette", "padel")).toBeNull(); // padel:16 → masqué
    expect(plausibleCourtCount(20, "raquette", "tennis")).toBe(20); // tennis:30 → affiché
  });
});

describe("getCourtCountDisplay (#636)", () => {
  it("absent ou nul → none", () => {
    expect(getCourtCountDisplay(null).kind).toBe("none");
    expect(getCourtCountDisplay(undefined).kind).toBe("none");
    expect(getCourtCountDisplay(0).kind).toBe("none");
    expect(getCourtCountDisplay(-3).kind).toBe("none");
  });

  it("valeur plausible → exact avec le compte", () => {
    expect(getCourtCountDisplay(4, { sportSlug: "tennis" })).toEqual({ kind: "exact", count: 4 });
    expect(getCourtCountDisplay(12, { sportSlug: "padel" })).toEqual({ kind: "exact", count: 12 });
  });

  // /en/tennis/fr/lyon : 112, 84, 60, 48 sont invraisemblables.
  it("Tennis Lyon : les counts gonflés ne sont JAMAIS affichés tels quels", () => {
    for (const n of [48, 60, 84, 112]) {
      expect(
        getCourtCountDisplay(n, { sportSlug: "tennis", familySlug: "raquette" }).kind
      ).not.toBe("exact");
    }
    // 48–112 ≤ 30×4 → libellé « plusieurs terrains » plutôt que le faux chiffre.
    expect(getCourtCountDisplay(48, { sportSlug: "tennis" }).kind).toBe("approx");
    expect(getCourtCountDisplay(112, { sportSlug: "tennis" }).kind).toBe("approx");
    // un vrai gros club reste crédible et affiché.
    expect(getCourtCountDisplay(28, { sportSlug: "tennis" })).toEqual({ kind: "exact", count: 28 });
  });

  // /en/padel/fr/paris : un « COURT DE PADEL » à beaucoup de pistes est suspect.
  it("Padel : seuil plus bas que tennis (même famille raquette)", () => {
    expect(getCourtCountDisplay(16, { sportSlug: "padel" }).kind).toBe("exact");
    expect(getCourtCountDisplay(17, { sportSlug: "padel" }).kind).toBe("approx");
    expect(getCourtCountDisplay(20, { sportSlug: "tennis" }).kind).toBe("exact");
    expect(getCourtCountDisplay(20, { sportSlug: "padel" }).kind).toBe("approx");
  });

  it("le sport prime sur la famille", () => {
    expect(getCourtCountDisplay(30, { sportSlug: "padel", familySlug: "raquette" }).kind).toBe(
      "approx"
    );
    expect(getCourtCountDisplay(30, { familySlug: "raquette" }).kind).toBe("exact");
  });

  it("valeur absurde (> 4× le seuil) → none, pas même un libellé", () => {
    expect(getCourtCountDisplay(200, { sportSlug: "tennis" }).kind).toBe("none"); // > 120
    expect(getCourtCountDisplay(121, { sportSlug: "tennis" }).kind).toBe("none");
    expect(getCourtCountDisplay(120, { sportSlug: "tennis" }).kind).toBe("approx"); // borne
  });

  it("sport ET famille inconnus → seuil par défaut", () => {
    expect(getCourtCountDisplay(50, {}).kind).toBe("exact");
    expect(getCourtCountDisplay(51, {}).kind).toBe("approx");
  });
});

describe("confiance par le nom — équipement générique (#697)", () => {
  it("détecte les libellés équipement, pas les clubs nommés", () => {
    for (const g of [
      "COURT DE PADEL",
      "Courts de tennis Extérieurs",
      "court de tennis ext",
      "Terrain de basket n°2",
      "Courts de tennis intérieurs",
      "Piste de padel 3",
    ]) {
      expect(isGenericEquipmentName(g), g).toBe(true);
    }
    for (const c of ["Casa Padel", "Tennis Club de Lyon", "We Are Padel", "Esprit Padel Lyon"]) {
      expect(isGenericEquipmentName(c), c).toBe(false);
    }
  });

  it("« COURT DE PADEL » + 9 courts → adouci (cas exact de l'issue)", () => {
    const d = getCourtCountDisplay(9, { sportSlug: "padel", name: "COURT DE PADEL" });
    expect(d.kind).toBe("approx"); // 9 ≤ plafond padel 16, mais nom générique
  });

  it("courts tennis Lyon 28/24/18/12 sur fiches équipement → adoucis", () => {
    for (const n of [28, 24, 18, 12]) {
      const d = getCourtCountDisplay(n, {
        sportSlug: "tennis",
        name: "Courts de tennis Extérieurs",
      });
      expect(d.kind, String(n)).toBe("approx");
    }
  });

  it("petit compte sur nom générique : crédible → exact", () => {
    expect(getCourtCountDisplay(2, { sportSlug: "padel", name: "Court de padel" })).toEqual({
      kind: "exact",
      count: 2,
    });
  });

  it("club NOMMÉ : le compte élevé plausible reste affiché", () => {
    expect(getCourtCountDisplay(9, { sportSlug: "padel", name: "Casa Padel" })).toEqual({
      kind: "exact",
      count: 9,
    });
    expect(getCourtCountDisplay(28, { sportSlug: "tennis", name: "Tennis Club de Lyon" })).toEqual({
      kind: "exact",
      count: 28,
    });
  });

  it("nom générique + valeur absurde → none (pas même un libellé)", () => {
    expect(
      getCourtCountDisplay(200, { sportSlug: "tennis", name: "Courts de tennis" }).kind,
    ).toBe("none");
  });

  it("plausibleCourtCount masque aussi via le nom (fiche venue)", () => {
    expect(plausibleCourtCount(9, "raquette", "padel", "COURT DE PADEL")).toBeNull();
    expect(plausibleCourtCount(9, "raquette", "padel", "Casa Padel")).toBe(9);
  });
});
