/**
 * Acceptance #639 — pages gym fiables et peu bruitées. Vérifie, sur des
 * exemples réels (Paris / Toulouse), que le couple règles gym (#638) + ranking
 * sport-aware (#637) :
 * - PROMEUT les vrais lieux d'entraînement (gym, fitness, CrossFit, Pilates,
 *   coaching, musculation, salle de sport) ;
 * - RÉTROGRADE le bruit (laser game, bowling, grappling, aquavélo, centre de
 *   loisirs, fédération/ligue) sans l'EXCLURE (démotion, pas suppression) ;
 * - ne sur-filtre PAS un gym multi-activités (le signal positif l'emporte).
 */
import { describe, expect, it } from "vitest";
import { getSportSignal, isSportContradiction } from "@/lib/venue/sport-rules";
import { venueQualityScoreForSport, type ScorableVenue } from "@/lib/venue/quality-score";

const gym = (name: string): ScorableVenue => ({ name, address: "1 rue X", city_name: "Toulouse" });

/** Trie comme la page (#637) : score gym décroissant, nom en tie-break stable. */
function rankForGym(names: string[]): string[] {
  return [...names]
    .map((name) => ({ name, s: venueQualityScoreForSport(gym(name), "gym") }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .map((v) => v.name);
}

describe("#639 — gym Toulouse : vrais gyms au-dessus du bruit", () => {
  it("classe les installations d'entraînement avant les lieux non liés", () => {
    const ranked = rankForGym([
      "Laser Game Évolution",
      "Basic-Fit Toulouse Wilson",
      "Grappling Club Toulouse",
      "CrossFit Toulouse",
      "Aquavélo Sept Deniers",
    ]);
    // Les deux vrais gyms (positifs) devant ; le bruit (suspects) derrière.
    expect(ranked.slice(0, 2).sort()).toEqual(["Basic-Fit Toulouse Wilson", "CrossFit Toulouse"]);
    expect(ranked.slice(2)).toEqual([
      "Aquavélo Sept Deniers",
      "Grappling Club Toulouse",
      "Laser Game Évolution",
    ]);
  });

  it("le bruit est RÉTROGRADÉ, jamais exclu (pas une contradiction dure)", () => {
    for (const noise of [
      "Laser Game Évolution",
      "Grappling Club Toulouse",
      "Aquavélo Sept Deniers",
      "Bowling de Toulouse",
      "Centre de loisirs municipal",
    ]) {
      expect(getSportSignal(noise, "gym")).toBe("suspicious");
      expect(isSportContradiction(noise, "gym")).toBe(false); // reste listable
    }
  });
});

describe("#639 — ne sur-filtre pas les vrais lieux d'entraînement", () => {
  it("CrossFit / Pilates / coaching / salle de sport = positifs", () => {
    for (const ok of [
      "CrossFit Halles",
      "Studio Pilates Lyon",
      "Coaching Sportif Paris",
      "Salle de sport Wilson",
      "Keep Cool Toulouse",
    ]) {
      expect(getSportSignal(ok, "gym")).toBe("positive");
    }
  });

  it("un gym multi-activités garde son signal positif (grappling EN PLUS)", () => {
    // « Fitness Park … grappling » : le positif (fitness) l'emporte sur le suspect.
    expect(getSportSignal("Fitness Park & Grappling", "gym")).toBe("positive");
  });
});

describe("#639 — gym Paris : enseignes reconnues priorisées", () => {
  it("les enseignes fitness passent devant une entrée neutre", () => {
    const ranked = rankForGym(["Espace Municipal Jean Jaurès", "Basic-Fit Paris Bastille"]);
    expect(ranked[0]).toBe("Basic-Fit Paris Bastille");
  });
});
