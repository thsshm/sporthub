import { describe, it, expect } from "vitest";
import { isSportMismatch, sinkMismatches } from "./sport-mismatch";

describe("isSportMismatch — exemples réels de l'audit #553 (tennis)", () => {
  it("exclut les équipements multisports génériques", () => {
    expect(isSportMismatch("SALLE MULTISPORTS Henri DUEZ", "tennis")).toBe(true);
    expect(isSportMismatch("TERRAIN MULTISPORT", "tennis")).toBe(true);
    expect(isSportMismatch("Salle polyvalente", "tennis")).toBe(true);
  });

  it("exclut piscine et musculation, même si le nom mentionne aussi le tennis", () => {
    expect(isSportMismatch("piscine decouverte", "tennis")).toBe(true);
    expect(isSportMismatch("Piscine découverte", "tennis")).toBe(true);
    expect(
      isSportMismatch("salle de musculation du tennis club du fort", "tennis"),
    ).toBe(true);
  });

  it("garde les vrais lieux de tennis", () => {
    expect(isSportMismatch("Tennis Club de Lyon", "tennis")).toBe(false);
    expect(isSportMismatch("Court de tennis 2", "tennis")).toBe(false);
    expect(isSportMismatch("Stade Roland-Garros", "tennis")).toBe(false);
  });
});

describe("isSportMismatch — padel / gym / football / basketball (acceptance #553)", () => {
  it("padel : piscine et fitness contredisent, un club de padel non", () => {
    expect(isSportMismatch("Piscine municipale", "padel")).toBe(true);
    expect(isSportMismatch("Espace Fitness", "padel")).toBe(true);
    expect(isSportMismatch("Padel Club Toulouse", "padel")).toBe(false);
  });

  it("gym : musculation/fitness sont POSITIFS, piscine contredit", () => {
    expect(isSportMismatch("Salle de musculation du tennis club", "gym")).toBe(false);
    expect(isSportMismatch("Fitness Park Lille", "gym")).toBe(false);
    expect(isSportMismatch("Piscine des Halles", "gym")).toBe(true);
  });

  it("football : piscine/patinoire contredisent, un stade non", () => {
    expect(isSportMismatch("Piscine olympique", "football")).toBe(true);
    expect(isSportMismatch("Patinoire municipale", "football")).toBe(true);
    expect(isSportMismatch("Stade municipal", "football")).toBe(false);
  });

  it("basketball : boulodrome contredit, un playground non", () => {
    expect(isSportMismatch("Boulodrome couvert", "basketball")).toBe(true);
    expect(isSportMismatch("Playground Duperré", "basketball")).toBe(false);
  });
});

describe("isSportMismatch — robustesse", () => {
  it("frontières de mot : pas de faux positif par substring (#591)", () => {
    // « gym » dans « gymnase » ne doit pas déclencher la liste gym d'un autre
    // sport ; « polyvalent » exige le mot, pas une sous-chaîne arbitraire.
    expect(isSportMismatch("Gymnase Jean Moulin", "football")).toBe(false);
    expect(isSportMismatch("La Polyvalence du jeu", "tennis")).toBe(false);
  });

  it("sport inconnu : seuls les termes génériques s'appliquent", () => {
    expect(isSportMismatch("Salle polyvalente", "curling")).toBe(true);
    expect(isSportMismatch("Piscine municipale", "curling")).toBe(false);
  });

  it("nom vide / null → jamais mismatch", () => {
    expect(isSportMismatch("", "tennis")).toBe(false);
    expect(isSportMismatch(null, "tennis")).toBe(false);
    expect(isSportMismatch(undefined, "tennis")).toBe(false);
  });
});

describe("sinkMismatches", () => {
  it("relègue les douteux en fin en préservant l'ordre relatif (tri stable)", () => {
    const list = [
      { name: "Piscine découverte" },
      { name: "Tennis Club A" },
      { name: "Salle polyvalente" },
      { name: "Tennis Club B" },
    ];
    expect(sinkMismatches(list, "tennis").map((v) => v.name)).toEqual([
      "Tennis Club A",
      "Tennis Club B",
      "Piscine découverte",
      "Salle polyvalente",
    ]);
  });

  it("liste sans douteux → inchangée", () => {
    const list = [{ name: "Tennis Club A" }, { name: "Tennis Club B" }];
    expect(sinkMismatches(list, "tennis")).toEqual(list);
  });
});
