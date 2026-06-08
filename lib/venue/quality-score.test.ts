import { describe, it, expect } from "vitest";
import {
  venueQualityScore,
  isLowQualityVenue,
  venueQualityBadge,
  LOW_QUALITY_THRESHOLD,
  HIGH_QUALITY_THRESHOLD,
  type ScorableVenue,
} from "./quality-score";

const empty: ScorableVenue = {};

describe("venueQualityScore", () => {
  it("score 0 pour une entrée squelette (nom + coords seulement)", () => {
    expect(venueQualityScore(empty)).toBe(0);
  });

  it("additionne les poids des signaux présents", () => {
    // address(20) + city(10) + sport(5) = 35
    expect(
      venueQualityScore({
        address: "1 rue du Stade",
        city_name: "Lyon",
        primary_sport_slug: "tennis",
      }),
    ).toBe(35);
  });

  it("ignore les chaînes vides ou blanches", () => {
    expect(
      venueQualityScore({ address: "   ", website_url: "", phone: null }),
    ).toBe(0);
  });

  it("compte city via city_id OU city_name", () => {
    expect(venueQualityScore({ city_id: "abc" })).toBe(10);
    expect(venueQualityScore({ city_name: "Paris" })).toBe(10);
  });

  it("description : venue.description OU enrichments.description (pas de double comptage)", () => {
    expect(venueQualityScore({ description: "Joli club" })).toBe(12);
    expect(
      venueQualityScore({ enrichments: { description: "Extrait wiki" } }),
    ).toBe(12);
    expect(
      venueQualityScore({
        description: "x",
        enrichments: { description: "y" },
      }),
    ).toBe(12);
  });

  it("rating compte seulement si note ET nombre d'avis > 0", () => {
    expect(
      venueQualityScore({ enrichments: { google_rating: 4.5 } }),
    ).toBe(0);
    expect(
      venueQualityScore({
        enrichments: { google_rating: 4.5, google_rating_count: 12 },
      }),
    ).toBe(8);
  });

  it("verified compte, pending/unclaimed non", () => {
    expect(venueQualityScore({ claim_status: "verified" })).toBe(10);
    expect(venueQualityScore({ claim_status: "pending" })).toBe(0);
  });

  it("plafonne à 100 même si tous les signaux sont présents", () => {
    const full: ScorableVenue = {
      address: "1 rue du Stade",
      city_name: "Lyon",
      website_url: "https://club.fr",
      phone: "+33...",
      description: "desc",
      primary_sport_slug: "tennis",
      claim_status: "verified",
      enrichments: {
        photo_url: "https://img",
        google_rating: 4.8,
        google_rating_count: 30,
      },
    };
    expect(venueQualityScore(full)).toBe(100);
  });
});

describe("isLowQualityVenue", () => {
  it("true pour une entrée squelette", () => {
    expect(isLowQualityVenue(empty)).toBe(true);
  });

  it("true juste sous le seuil, false au seuil", () => {
    // adresse seule = 20 < 25 → low
    expect(isLowQualityVenue({ address: "1 rue X" })).toBe(true);
    // adresse(20) + sport(5) = 25 → pas low
    expect(
      isLowQualityVenue({ address: "1 rue X", primary_sport_slug: "tennis" }),
    ).toBe(false);
  });

  it("est cohérent avec le seuil exporté", () => {
    expect(LOW_QUALITY_THRESHOLD).toBe(25);
  });
});

describe("venueQualityBadge", () => {
  const rich: ScorableVenue = {
    address: "1 rue X",
    city_name: "Lyon",
    website_url: "https://club.example",
    phone: "0102030405",
    description: "Club de tennis avec 6 courts.",
  };

  it("verified quand la fiche est revendiquée et vérifiée", () => {
    expect(venueQualityBadge({ claim_status: "verified" })).toBe("verified");
  });

  it("verified l'emporte même avec un score faible", () => {
    expect(
      venueQualityBadge({ claim_status: "verified", address: "1 rue X" }),
    ).toBe("verified");
  });

  it("complete quand le score atteint le seuil haut", () => {
    expect(venueQualityScore(rich)).toBeGreaterThanOrEqual(HIGH_QUALITY_THRESHOLD);
    expect(venueQualityBadge(rich)).toBe("complete");
  });

  it("null pour une fiche pauvre (pas de badge négatif)", () => {
    expect(venueQualityBadge({ address: "1 rue X" })).toBe(null);
    expect(venueQualityBadge(empty)).toBe(null);
  });

  it("seuil haut exporté = 60", () => {
    expect(HIGH_QUALITY_THRESHOLD).toBe(60);
  });
});
