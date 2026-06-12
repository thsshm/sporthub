import { describe, expect, it } from "vitest";
import {
  getSportSignal,
  isSportContradiction,
  sportSignalScore,
  sportSignalRank,
} from "@/lib/venue/sport-rules";

describe("getSportSignal — padel (#638)", () => {
  it("positif : padel/paddle/casa padel + enseignes (#695)", () => {
    expect(getSportSignal("Casa Padel Saint-Denis", "padel")).toBe("positive");
    expect(getSportSignal("Padellers Lyon", "padel")).toBe("positive");
    expect(getSportSignal("Le Paddle Club", "padel")).toBe("positive");
    expect(getSportSignal("We Are Padel Bordeaux", "padel")).toBe("positive");
    expect(getSportSignal("Padelshot Nantes", "padel")).toBe("positive");
  });
  it("suspect : tennis-only/squash SANS signal padel, circuit/karting", () => {
    expect(getSportSignal("Tennis Club de Lyon", "padel")).toBe("suspicious");
    expect(getSportSignal("COURT DE TENNIS EXT", "padel")).toBe("suspicious");
    expect(getSportSignal("Squash Club Marseille", "padel")).toBe("suspicious");
    expect(getSportSignal("Circuit de karting", "padel")).toBe("suspicious");
  });
  it("le signal POSITIF l'emporte sur le suspect (multi-sport légitime)", () => {
    // « Tennis & Padel Club » mentionne tennis (suspect) ET padel (positif).
    expect(getSportSignal("Tennis & Padel Club", "padel")).toBe("positive");
  });
  it("contradiction : équestre / pêche exclus des listes padel (#695)", () => {
    // Faux positifs live : équipement équestre, plans d'eau → jamais du padel.
    expect(
      getSportSignal("Écuries de propriétaires - manège, carrière", "padel"),
    ).toBe("contradiction");
    expect(getSportSignal("Manège équestre", "padel")).toBe("contradiction");
    expect(getSportSignal("Hippodrome de Vincennes", "padel")).toBe("contradiction");
    expect(getSportSignal("Étang de pêche du Moulin", "padel")).toBe("contradiction");
  });
  it("contradiction : piscine/fitness restent une exclusion dure", () => {
    expect(getSportSignal("Piscine municipale", "padel")).toBe("contradiction");
    expect(getSportSignal("Espace Fitness", "padel")).toBe("contradiction");
  });
});

describe("getSportSignal — gym (#638)", () => {
  it("positif : enseignes et termes fitness", () => {
    expect(getSportSignal("Basic-Fit Paris Bastille", "gym")).toBe("positive");
    expect(getSportSignal("Keep Cool Toulouse", "gym")).toBe("positive");
    expect(getSportSignal("CrossFit Halles", "gym")).toBe("positive");
    expect(getSportSignal("Salle de musculation du tennis club", "gym")).toBe("positive");
  });
  it("suspect : fédération/ligue/comité, laser game, centre de loisirs", () => {
    expect(getSportSignal("Laser Game Évolution", "gym")).toBe("suspicious");
    expect(getSportSignal("Ligue de gymnastique", "gym")).toBe("suspicious");
    expect(getSportSignal("Centre de loisirs municipal", "gym")).toBe("suspicious");
  });
  it("contradiction : piscine reste exclue", () => {
    expect(getSportSignal("Piscine des Halles", "gym")).toBe("contradiction");
  });
});

describe("getSportSignal — tennis (#638)", () => {
  it("positif : tennis/court/FFT/Roland-Garros", () => {
    expect(getSportSignal("Tennis Club de Lyon", "tennis")).toBe("positive");
    expect(getSportSignal("Stade Roland-Garros", "tennis")).toBe("positive");
    expect(getSportSignal("Courts couverts FFT", "tennis")).toBe("positive");
  });
  it("contradiction : muscu/piscine, même avec « tennis » dans le nom", () => {
    expect(getSportSignal("Salle de musculation du tennis club", "tennis")).toBe("contradiction");
    expect(getSportSignal("Piscine découverte", "tennis")).toBe("contradiction");
  });
  it("neutre : un nom sans aucun signal", () => {
    expect(getSportSignal("Espace Jean Moulin", "tennis")).toBe("neutral");
  });
});

describe("getSportSignal — robustesse", () => {
  it("sport sans règle : seul le générique multi-sport contredit", () => {
    expect(getSportSignal("Salle polyvalente", "curling")).toBe("contradiction");
    expect(getSportSignal("Piscine municipale", "curling")).toBe("neutral");
  });
  it("frontières de mot : pas de faux positif par substring (#591)", () => {
    expect(getSportSignal("Gymnase Jean Moulin", "football")).toBe("neutral"); // pas « gym »
    expect(getSportSignal("La Polyvalence du jeu", "tennis")).toBe("neutral");
  });
  it("nom vide / null → neutral", () => {
    expect(getSportSignal("", "tennis")).toBe("neutral");
    expect(getSportSignal(null, "tennis")).toBe("neutral");
    expect(getSportSignal(undefined, "tennis")).toBe("neutral");
  });
});

describe("isSportContradiction / sportSignalScore / sportSignalRank", () => {
  it("isSportContradiction = signal contradiction uniquement", () => {
    expect(isSportContradiction("Piscine des Halles", "gym")).toBe(true);
    expect(isSportContradiction("Laser Game Évolution", "gym")).toBe(false); // suspect ≠ exclusion
    expect(isSportContradiction("Basic-Fit", "gym")).toBe(false);
  });
  it("score : positif > neutre > suspect > contradiction", () => {
    expect(sportSignalScore("Basic-Fit", "gym")).toBe(15);
    expect(sportSignalScore("Espace Jean Moulin", "gym")).toBe(0);
    expect(sportSignalScore("Laser Game", "gym")).toBe(-20);
    expect(sportSignalScore("Piscine", "gym")).toBe(-40);
  });
  it("rank : ordonne positif(0) < neutre(1) < suspect(2) < contradiction(3)", () => {
    expect(sportSignalRank("Basic-Fit", "gym")).toBe(0);
    expect(sportSignalRank("Espace Jean Moulin", "gym")).toBe(1);
    expect(sportSignalRank("Laser Game", "gym")).toBe(2);
    expect(sportSignalRank("Piscine", "gym")).toBe(3);
  });
});
