import { describe, expect, it } from "vitest";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import {
  getSportEmoji,
  MAIN_SPORT_SLUGS,
  SPORTS,
  SPORTS_BY_FAMILY,
  SPORTS_BY_SLUG,
} from "@/lib/sports";

describe("SPORTS — invariants sur le référentiel", () => {
  it("a au moins 50 sports", () => {
    expect(SPORTS.length).toBeGreaterThanOrEqual(50);
  });

  it("a tous les slugs uniques (PK)", () => {
    const slugs = SPORTS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("chaque sport a une family_slug qui existe dans FAMILIES (FK)", () => {
    for (const s of SPORTS) {
      expect(
        FAMILIES_BY_SLUG[s.family_slug],
        `sport ${s.slug} référence famille inconnue ${s.family_slug}`,
      ).toBeDefined();
    }
  });

  it("chaque sport a tous les champs requis", () => {
    for (const s of SPORTS) {
      expect(s.slug, `slug ${s.slug}`).toMatch(/^[a-z_]+$/);
      expect(s.name_fr.length, `name_fr ${s.slug}`).toBeGreaterThan(0);
      expect(s.name_en.length, `name_en ${s.slug}`).toBeGreaterThan(0);
      expect(s.emoji.length, `emoji ${s.slug}`).toBeGreaterThan(0);
      expect(s.color, `color ${s.slug}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.position, `position ${s.slug}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("la position est unique au sein d'une famille (pas de conflit d'ordre)", () => {
    const seen = new Map<string, Set<number>>();
    for (const s of SPORTS) {
      const positions = seen.get(s.family_slug) ?? new Set<number>();
      expect(
        positions.has(s.position),
        `position ${s.position} dupliquée dans famille ${s.family_slug}`,
      ).toBe(false);
      positions.add(s.position);
      seen.set(s.family_slug, positions);
    }
  });
});

describe("SPORTS_BY_SLUG", () => {
  it("retrouve un sport par slug", () => {
    expect(SPORTS_BY_SLUG["tennis"]?.name_fr).toBe("Tennis");
    expect(SPORTS_BY_SLUG["padel"]?.family_slug).toBe("raquette");
  });

  it("contient autant d'entrées que SPORTS", () => {
    expect(Object.keys(SPORTS_BY_SLUG)).toHaveLength(SPORTS.length);
  });
});

describe("SPORTS_BY_FAMILY", () => {
  it("groupe correctement par famille", () => {
    expect(SPORTS_BY_FAMILY["raquette"]?.length).toBeGreaterThanOrEqual(5);
    expect(
      SPORTS_BY_FAMILY["raquette"]?.every((s) => s.family_slug === "raquette"),
    ).toBe(true);
  });

  it("couvre les 14 familles", () => {
    const families = Object.keys(SPORTS_BY_FAMILY);
    expect(families.length).toBe(14);
  });
});

describe("MAIN_SPORT_SLUGS", () => {
  it("contient 10 slugs", () => {
    expect(MAIN_SPORT_SLUGS).toHaveLength(10);
  });

  it("tous les slugs principaux existent dans SPORTS", () => {
    for (const slug of MAIN_SPORT_SLUGS) {
      expect(
        SPORTS_BY_SLUG[slug],
        `main sport ${slug} introuvable dans SPORTS`,
      ).toBeDefined();
    }
  });
});

describe("getSportEmoji — emoji du pin carte", () => {
  it("retourne l'emoji d'un sport curé", () => {
    expect(getSportEmoji("padel")).toBe(SPORTS_BY_SLUG["padel"].emoji);
    expect(getSportEmoji("tennis")).toBe(SPORTS_BY_SLUG["tennis"].emoji);
  });

  it("retourne un emoji non vide pour CHAQUE sport curé", () => {
    for (const s of SPORTS) {
      expect(getSportEmoji(s.slug), `emoji manquant pour ${s.slug}`).toBeTruthy();
    }
  });

  it("retourne null pour un slug inconnu ou vide (→ fallback famille au call site)", () => {
    expect(getSportEmoji("sport_inexistant_xyz")).toBeNull();
    expect(getSportEmoji(null)).toBeNull();
    expect(getSportEmoji(undefined)).toBeNull();
    expect(getSportEmoji("")).toBeNull();
  });
});
