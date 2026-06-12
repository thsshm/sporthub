import { describe, expect, it } from "vitest";
import { getArrondissement } from "@/lib/venue/district";

describe("getArrondissement (#703)", () => {
  it("Paris : dérive l'arrondissement du code postal", () => {
    expect(getArrondissement("12 Rue Oberkampf, 75011 Paris", "Paris")).toBe("11e");
    expect(getArrondissement("1 Place Vendôme, 75001 Paris", "Paris")).toBe("1er");
    expect(getArrondissement("75020 Paris", "Paris")).toBe("20e");
    expect(getArrondissement("8 Av. Foch, 75116 Paris", "Paris")).toBe("16e"); // forme 751xx
  });

  it("Lyon / Marseille", () => {
    expect(getArrondissement("5 Rue de la Ré, 69003 Lyon", "Lyon")).toBe("3e");
    expect(getArrondissement("69001 Lyon", "Lyon")).toBe("1er");
    expect(getArrondissement("13008 Marseille", "Marseille")).toBe("8e");
  });

  it("insensible à la casse / aux accents de la ville", () => {
    expect(getArrondissement("75011 PARIS", "PARIS")).toBe("11e");
    expect(getArrondissement("69002 Lyon", "lyon")).toBe("2e");
  });

  it("ne fabrique JAMAIS : pas d'adresse, pas de CP, ville sans arrondissement", () => {
    expect(getArrondissement(null, "Paris")).toBeNull();
    expect(getArrondissement("Paris", "Paris")).toBeNull(); // pas de CP
    expect(getArrondissement("12 Rue X, Bordeaux", "Bordeaux")).toBeNull();
    expect(getArrondissement("33000 Bordeaux", "Bordeaux")).toBeNull(); // ville sans arrondissement
  });

  it("pas de faux positif : CP du même département mais hors arrondissements", () => {
    // 69100 = Villeurbanne (dép. 69) : PAS un arrondissement de Lyon.
    expect(getArrondissement("69100 Villeurbanne", "Lyon")).toBeNull();
    // 75021 n'existe pas comme arrondissement.
    expect(getArrondissement("75021 Paris", "Paris")).toBeNull();
  });
});
