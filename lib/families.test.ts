import { describe, expect, it } from "vitest";
import {
  FAMILIES,
  FAMILIES_BY_SLUG,
  getFamilyColor,
  getFamilyEmoji,
} from "@/lib/families";

describe("FAMILIES — invariants sur le référentiel", () => {
  it("contient exactement 13 familles (cf. CLAUDE.md)", () => {
    expect(FAMILIES).toHaveLength(13);
  });

  it("a tous les slugs uniques", () => {
    const slugs = FAMILIES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("inclut les 13 familles canon de la V1", () => {
    const expected = [
      "raquette",
      "ballon",
      "fitness",
      "combat",
      "yoga",
      "baignade",
      "boules",
      "nautique",
      "glisse",
      "snow",
      "hike",
      "retraites",
      "plus",
    ];
    expect(FAMILIES.map((f) => f.slug).sort()).toEqual(expected.sort());
  });

  it("chaque famille a tous les champs requis non-vides", () => {
    for (const f of FAMILIES) {
      expect(f.slug, `slug famille ${f.slug}`).toMatch(/^[a-z_]+$/);
      expect(f.name_fr.length, `name_fr famille ${f.slug}`).toBeGreaterThan(0);
      expect(f.name_en.length, `name_en famille ${f.slug}`).toBeGreaterThan(0);
      expect(f.emoji.length, `emoji famille ${f.slug}`).toBeGreaterThan(0);
      expect(f.color, `color famille ${f.slug}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Array.isArray(f.sports), `sports famille ${f.slug}`).toBe(true);
    }
  });

  it("a des couleurs uniques (pas de doublon visuel)", () => {
    const colors = FAMILIES.map((f) => f.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("FAMILIES_BY_SLUG", () => {
  it("est indexé par slug", () => {
    expect(FAMILIES_BY_SLUG["raquette"]?.name_fr).toBe("Raquette");
    expect(FAMILIES_BY_SLUG["yoga"]?.name_fr).toBe("Bien-être");
  });

  it("contient autant d'entrées que FAMILIES", () => {
    expect(Object.keys(FAMILIES_BY_SLUG)).toHaveLength(FAMILIES.length);
  });
});

describe("getFamilyColor", () => {
  it("retourne la couleur d'une famille connue", () => {
    expect(getFamilyColor("raquette")).toBe("#2d7a3e");
    expect(getFamilyColor("ballon")).toBe("#b45309");
  });

  it("fallback gris pour un slug inconnu", () => {
    expect(getFamilyColor("inconnu")).toBe("#6b7280");
    expect(getFamilyColor("")).toBe("#6b7280");
  });
});

describe("getFamilyEmoji", () => {
  it("retourne l'emoji d'une famille connue", () => {
    expect(getFamilyEmoji("raquette")).toBe("🎾");
    expect(getFamilyEmoji("ballon")).toBe("⚽");
  });

  it("fallback stadium pour un slug inconnu", () => {
    expect(getFamilyEmoji("inconnu")).toBe("🏟️");
  });
});

describe("invariant V1↔V2 sur le mapping yoga (cf. CLAUDE.md)", () => {
  it("garde le slug 'yoga' interne avec display 'Bien-être' / 'Wellness'", () => {
    const yoga = FAMILIES_BY_SLUG["yoga"];
    expect(yoga).toBeDefined();
    expect(yoga?.name_fr).toBe("Bien-être");
    expect(yoga?.name_en).toBe("Wellness");
  });
});
