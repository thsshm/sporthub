import { describe, expect, it } from "vitest";
import { groupByClub } from "@/lib/venue/group-by-club";

type V = {
  id: string;
  name: string;
  club_id?: string | null;
  courts_count?: number | null;
  lat?: number;
  lon?: number;
  primary_sport_slug?: string | null;
};

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

describe("groupByClub — aspiration des orphelins-équipement (#696)", () => {
  const clubs = new Map([["c1", "Tennis · Lyon"]]);
  // Club de 2 courts vers 45.7485 / 4.8055.
  const clubRows: V[] = [
    { id: "v1", name: "courts de tennis terre battue", club_id: "c1", courts_count: 2, lat: 45.7485, lon: 4.8055, primary_sport_slug: "tennis" },
    { id: "v2", name: "courts couverts", club_id: "c1", courts_count: 2, lat: 45.7486, lon: 4.8056, primary_sport_slug: "tennis" },
  ];

  it("aspire une fiche-équipement orpheline proche (≤150 m) dans le club", () => {
    const orphan: V = {
      id: "v0", // plus petit id, mais sans club → ne doit pas devenir canonique
      name: "court de tennis béton poreux",
      club_id: null,
      courts_count: 1,
      lat: 45.749, // ~50-100 m du club
      lon: 4.806,
      primary_sport_slug: "tennis",
    };
    const out = groupByClub([orphan, ...clubRows], clubs);
    expect(out).toHaveLength(1); // tout dans la card de club
    expect(out[0].name).toBe("Tennis · Lyon");
    expect(out[0].courts_count).toBe(5); // 2 + 2 + 1 (orphelin aspiré)
    expect(out[0].groupedCount).toBe(3);
  });

  it("n'aspire PAS un vrai lieu nommé voisin", () => {
    const named: V = {
      id: "n1",
      name: "Tennis Club Chavril",
      club_id: null,
      lat: 45.749,
      lon: 4.806,
      primary_sport_slug: "tennis",
    };
    const out = groupByClub([...clubRows, named], clubs);
    expect(out.some((v) => v.name === "Tennis Club Chavril")).toBe(true); // reste séparé
  });

  it("n'aspire PAS un orphelin trop loin (>150 m) ni d'un autre sport", () => {
    const far: V = { id: "f1", name: "court de tennis", club_id: null, lat: 45.76, lon: 4.82, primary_sport_slug: "tennis" };
    const otherSport: V = { id: "o1", name: "terrain de foot", club_id: null, lat: 45.7485, lon: 4.8055, primary_sport_slug: "football" };
    const out = groupByClub([...clubRows, far, otherSport], clubs);
    expect(out.some((v) => v.id === "f1")).toBe(true);
    expect(out.some((v) => v.id === "o1")).toBe(true);
  });
});
