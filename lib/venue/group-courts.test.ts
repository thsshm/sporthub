import { describe, expect, it } from "vitest";
import { baseName, displayName, groupCourtRecords } from "@/lib/venue/group-courts";

describe("baseName / displayName (alignés sur merge_court_records.py #554)", () => {
  it("base_name : strip du numéro final, null si pas de numéro", () => {
    expect(baseName("Court de Padel 1")).toBe("Court de Padel");
    expect(baseName("Sportfield 16 piste 1")).toBe("Sportfield 16 piste");
    expect(baseName("Terrain n°4")).toBe("Terrain");
    expect(baseName("Tennis Club de Lyon")).toBeNull(); // pas de numéro
    expect(baseName("COURT DE PADEL")).toBeNull(); // générique, pas un candidat
    expect(baseName("Stade 2000")).toBe("Stade"); // capté…
  });

  it("display_name : retire le mot-court résiduel", () => {
    expect(displayName("Sportfield 16 piste")).toBe("Sportfield 16");
    expect(displayName("Court de Padel")).toBe("Court de Padel"); // « de Padel » pas un mot-court isolé
    expect(displayName("Terrain")).toBe("Terrain"); // n'efface pas tout → garde la base
  });
});

const v = (
  id: string,
  name: string,
  extra: Partial<{ source: string; primary_sport_slug: string; courts_count: number }> = {}
) => ({
  id,
  name,
  lat: 48.85,
  lon: 2.35,
  source: extra.source ?? "osm",
  primary_sport_slug: extra.primary_sport_slug ?? "padel",
  courts_count: extra.courts_count ?? 1,
});

describe("groupCourtRecords (#635)", () => {
  it("Padel Paris : collapse les pistes en une card de club + courts_count agrégé", () => {
    const out = groupCourtRecords([
      v("a", "Sportfield 16 piste 1"),
      v("b", "Sportfield 16 piste 2"),
      v("c", "Sportfield 16 piste 3"),
      v("d", "COURT DE PADEL"), // générique → reste séparé
    ]);
    expect(out).toHaveLength(2);
    const club = out.find((o) => o.id === "a")!; // canonique = plus petit id
    expect(club.name).toBe("Sportfield 16");
    expect(club.courts_count).toBe(3);
    expect(club.groupedCount).toBe(3);
    expect(out.find((o) => o.name === "COURT DE PADEL")?.groupedCount).toBe(1);
  });

  it("ne renomme JAMAIS un singleton (Stade 2000 reste tel quel)", () => {
    const out = groupCourtRecords([v("x", "Stade 2000"), v("y", "Tennis Club de Lyon")]);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.id === "x")?.name).toBe("Stade 2000");
    expect(out.every((o) => o.groupedCount === 1)).toBe(true);
  });

  it("ne sur-fusionne pas : source/sport/coords différents → groupes distincts", () => {
    const out = groupCourtRecords([
      v("a", "Court de Padel 1", { source: "osm" }),
      v("b", "Court de Padel 2", { source: "res" }), // source ≠ → pas fusionné
      v("c", "Court de Padel 3", { primary_sport_slug: "tennis" }), // sport ≠ → pas fusionné
    ]);
    // 3 clés distinctes, toutes singletons → aucun regroupement.
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.groupedCount === 1)).toBe(true);
  });

  it("coords éloignées (> ~110 m) → non fusionnées", () => {
    const a = { ...v("a", "Court de Padel 1"), lat: 48.85, lon: 2.35 };
    const b = { ...v("b", "Court de Padel 2"), lat: 48.86, lon: 2.36 }; // ~1,3 km
    const out = groupCourtRecords([a, b]);
    expect(out).toHaveLength(2);
  });

  it("liste sans candidat court-level → renvoyée intacte", () => {
    const input = [v("a", "Tennis Club de Lyon"), v("b", "Roland Garros")];
    const out = groupCourtRecords(input);
    expect(out.map((o) => o.name)).toEqual(["Tennis Club de Lyon", "Roland Garros"]);
  });

  it("courts_count agrégé tolère les null (→ 1 par membre)", () => {
    const out = groupCourtRecords([
      { ...v("a", "Court de Padel 1"), courts_count: null },
      { ...v("b", "Court de Padel 2"), courts_count: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].courts_count).toBe(2);
  });
});
