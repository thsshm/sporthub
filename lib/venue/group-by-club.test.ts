import { describe, expect, it } from "vitest";
import { groupByClub } from "@/lib/venue/group-by-club";

type V = { id: string; name: string; club_id?: string | null; courts_count?: number | null };

describe("groupByClub (#696)", () => {
  const clubs = new Map([["c1", "Tennis · Lyon"]]);

  it("collapse les fiches surface d'un même club en UNE card de club", () => {
    const rows: V[] = [
      { id: "v3", name: "Courts de tennis terre battue", club_id: "c1", courts_count: 4 },
      { id: "v1", name: "Court de tennis béton poreux", club_id: "c1", courts_count: 2 },
      { id: "v2", name: "Courts couverts en green set", club_id: "c1", courts_count: 3 },
    ];
    const out = groupByClub(rows, clubs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("v1"); // canonique = plus petit id
    expect(out[0].name).toBe("Tennis · Lyon"); // nom du club
    expect(out[0].courts_count).toBe(9); // somme
    expect(out[0].groupedCount).toBe(3);
  });

  it("ne touche pas les venues sans club_id", () => {
    const rows: V[] = [
      { id: "a", name: "Mouratoglou Country Club", club_id: null },
      { id: "b", name: "Court isolé", club_id: undefined },
    ];
    const out = groupByClub(rows, clubs);
    expect(out).toHaveLength(2);
    expect(out.every((v) => v.groupedCount === 1)).toBe(true);
  });

  it("club inconnu (absent de la map) → fiches laissées intactes", () => {
    const rows: V[] = [
      { id: "a", name: "X terre battue", club_id: "c-inconnu" },
      { id: "b", name: "X béton", club_id: "c-inconnu" },
    ];
    const out = groupByClub(rows, clubs);
    expect(out).toHaveLength(2); // pas de collapse sans nom → jamais de card « undefined »
  });

  it("club à un seul membre → inchangé (pas de renommage)", () => {
    const rows: V[] = [{ id: "a", name: "Court de tennis n°5", club_id: "c1" }];
    const out = groupByClub(rows, clubs);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Court de tennis n°5"); // nom d'origine conservé
    expect(out[0].groupedCount).toBe(1);
  });

  it("préserve l'ordre de première occurrence et les autres venues", () => {
    const rows: V[] = [
      { id: "z", name: "Autre lieu", club_id: null },
      { id: "v2", name: "surface B", club_id: "c1", courts_count: 1 },
      { id: "v1", name: "surface A", club_id: "c1", courts_count: 1 },
    ];
    const out = groupByClub(rows, clubs);
    expect(out.map((v) => v.id)).toEqual(["z", "v1"]); // z intact, club collapsé sur canonique v1
  });
});
