import { describe, expect, it } from "vitest";
import { getVisibleVenueCount } from "@/lib/venue/visible-count";
import { LOW_QUALITY_THRESHOLD } from "@/lib/venue/quality-score";

/**
 * Tests de non-régression #556 — le compteur « visible » commun.
 *
 * Le helper est DB-bound : on le teste avec un client Supabase factice
 * chaînable qui ENREGISTRE la requête composée (table, filtres, mode de count)
 * et renvoie un résultat contrôlé. Ça fige le CONTRAT du compteur commun :
 * appartenance au sport via mv_venue_sport_search, ville/qualité optionnels,
 * exact vs planned — la divergence de sémantique entre surfaces est exactement
 * le bug d'origine (#556 : home vs page sport vs page ville).
 */

type Captured = {
  table?: string;
  countMode?: string;
  head?: boolean;
  eq: Record<string, unknown>;
  gte: Record<string, unknown>;
};

function makeSb(result: { count: number | null; error: unknown }) {
  const captured: Captured = { eq: {}, gte: {} };
  const builder: Record<string, unknown> = {
    select(_cols: string, opts: { count: string; head: boolean }) {
      captured.countMode = opts.count;
      captured.head = opts.head;
      return builder;
    },
    eq(col: string, val: unknown) {
      captured.eq[col] = val;
      return builder;
    },
    gte(col: string, val: unknown) {
      captured.gte[col] = val;
      return builder;
    },
    then(resolve: (v: typeof result) => void) {
      // thenable → `await q` fonctionne comme avec le vrai builder PostgREST.
      resolve(result);
    },
  };
  const sb = {
    from(table: string) {
      captured.table = table;
      return builder;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: sb as any, captured };
}

describe("getVisibleVenueCount — contrat du compteur commun (#556)", () => {
  it("compte par APPARTENANCE au sport via mv_venue_sport_search", async () => {
    const { sb, captured } = makeSb({ count: 42, error: null });
    const n = await getVisibleVenueCount(sb, { sportSlug: "tennis" });
    expect(n).toBe(42);
    expect(captured.table).toBe("mv_venue_sport_search");
    expect(captured.eq.sport_slug).toBe("tennis");
    expect(captured.head).toBe(true);
  });

  it("exact par défaut (scope borné), planned sur demande (scope national)", async () => {
    const a = makeSb({ count: 1, error: null });
    await getVisibleVenueCount(a.sb, { sportSlug: "tennis", cityId: "c1" });
    expect(a.captured.countMode).toBe("exact");

    const b = makeSb({ count: 1, error: null });
    await getVisibleVenueCount(b.sb, { sportSlug: "gym", exact: false });
    expect(b.captured.countMode).toBe("planned");
  });

  it("erreur DB ou count null → 0 (jamais NaN/undefined dans un H1)", async () => {
    const a = makeSb({ count: null, error: { message: "boom" } });
    expect(await getVisibleVenueCount(a.sb, { sportSlug: "padel" })).toBe(0);
    const b = makeSb({ count: null, error: null });
    expect(await getVisibleVenueCount(b.sb, { sportSlug: "padel" })).toBe(0);
  });
});

describe("non-régression #556 — combos de l'audit produit", () => {
  it("Padel (page sport globale) : appartenance, SANS ville, seuil qualité optionnel", async () => {
    // Bug d'origine : « la home annonce 68k racket, Padel Paris a 8 lieux, mais
    // la page globale Padel affiche No venue ». Le compteur global doit lire la
    // MV d'appartenance (pas primary seul) et tolérer le mode planned.
    const { sb, captured } = makeSb({ count: 1398, error: null });
    const n = await getVisibleVenueCount(sb, { sportSlug: "padel", exact: false });
    expect(n).toBe(1398);
    expect(captured.table).toBe("mv_venue_sport_search");
    expect(captured.eq.city_id).toBeUndefined();
  });

  it.each([
    ["petanque", "marseille-id", 55],
    ["football", "lille-id", 8],
    ["basketball", "rennes-id", 31],
  ])(
    "%s × %s : compteur ville borné par city_id, exact",
    async (sport, cityId, total) => {
      // Bug d'origine : pages ville « No address » avec « 0 in view – N total ».
      // Le compteur ville doit être borné par city_id ET exact (pas une
      // estimation planner qui divergeait du rendu, cf. #335).
      const { sb, captured } = makeSb({ count: total, error: null });
      const n = await getVisibleVenueCount(sb, { sportSlug: sport, cityId });
      expect(n).toBe(total);
      expect(captured.eq.city_id).toBe(cityId);
      expect(captured.countMode).toBe("exact");
    },
  );

  it("seuil qualité optionnel : appliqué uniquement quand demandé (#464)", async () => {
    // Les listes SEO comptent en ≥ seuil ; la carte et le total exhaustif NON.
    // Les deux usages passent par le MÊME helper — seule l'option diffère.
    const withQ = makeSb({ count: 31, error: null });
    await getVisibleVenueCount(withQ.sb, {
      sportSlug: "tennis",
      cityId: "paris-id",
      minQualityScore: LOW_QUALITY_THRESHOLD,
    });
    expect(withQ.captured.gte.quality_score).toBe(LOW_QUALITY_THRESHOLD);

    const withoutQ = makeSb({ count: 68, error: null });
    await getVisibleVenueCount(withoutQ.sb, { sportSlug: "tennis", cityId: "paris-id" });
    expect(withoutQ.captured.gte.quality_score).toBeUndefined();
  });
});
