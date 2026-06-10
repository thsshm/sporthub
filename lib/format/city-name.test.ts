import { describe, expect, it } from "vitest";
import { formatCityName } from "@/lib/format/city-name";

describe("formatCityName", () => {
  it("remet en casse de titre les noms tout en majuscules", () => {
    expect(formatCityName("PARIS")).toBe("Paris");
    expect(formatCityName("MARSEILLE")).toBe("Marseille");
  });

  it("met les particules en minuscules (sauf en tête)", () => {
    expect(formatCityName("AIX-EN-PROVENCE")).toBe("Aix-en-Provence");
    expect(formatCityName("LE MANS")).toBe("Le Mans");
    expect(formatCityName("L'HAŸ-LES-ROSES")).toBe("L'haÿ-les-Roses");
  });

  it("gère les traits d'union et accents", () => {
    expect(formatCityName("SAINT-ÉTIENNE")).toBe("Saint-Étienne");
  });

  it("garde les ordinaux d'arrondissement en minuscules", () => {
    expect(formatCityName("PARIS 3E")).toBe("Paris 3e");
    expect(formatCityName("LYON 1ER")).toBe("Lyon 1er");
  });

  it("NE touche PAS un nom déjà correctement casé", () => {
    expect(formatCityName("Le Mans")).toBe("Le Mans");
    expect(formatCityName("Saint-Étienne")).toBe("Saint-Étienne");
    expect(formatCityName("Aix-en-Provence")).toBe("Aix-en-Provence");
  });

  it("robuste aux valeurs vides", () => {
    expect(formatCityName(null)).toBe("");
    expect(formatCityName(undefined)).toBe("");
    expect(formatCityName("")).toBe("");
  });
});
