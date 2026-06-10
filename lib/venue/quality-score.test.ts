import { describe, it, expect } from "vitest";
import {
  venueQualityScore,
  isLowQualityVenue,
  venueQualityBadge,
  isOrganizationName,
  ORGANIZATION_PENALTY,
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
      })
    ).toBe(35);
  });

  it("ignore les chaînes vides ou blanches", () => {
    expect(venueQualityScore({ address: "   ", website_url: "", phone: null })).toBe(0);
  });

  it("compte city via city_id OU city_name", () => {
    expect(venueQualityScore({ city_id: "abc" })).toBe(10);
    expect(venueQualityScore({ city_name: "Paris" })).toBe(10);
  });

  it("description : venue.description OU enrichments.description (pas de double comptage)", () => {
    expect(venueQualityScore({ description: "Joli club" })).toBe(12);
    expect(venueQualityScore({ enrichments: { description: "Extrait wiki" } })).toBe(12);
    expect(
      venueQualityScore({
        description: "x",
        enrichments: { description: "y" },
      })
    ).toBe(12);
  });

  it("rating compte seulement si note ET nombre d'avis > 0", () => {
    expect(venueQualityScore({ enrichments: { google_rating: 4.5 } })).toBe(0);
    expect(
      venueQualityScore({
        enrichments: { google_rating: 4.5, google_rating_count: 12 },
      })
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
    expect(isLowQualityVenue({ address: "1 rue X", primary_sport_slug: "tennis" })).toBe(false);
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
    expect(venueQualityBadge({ claim_status: "verified", address: "1 rue X" })).toBe("verified");
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

describe("isOrganizationName / ORGANIZATION_PENALTY (#588)", () => {
  it("détecte fédérations, ligues, comités, districts (accents inclus)", () => {
    expect(isOrganizationName("Fédération Française de Gymnastique")).toBe(true);
    expect(isOrganizationName("Ligue Île-de-France de gymnastique")).toBe(true);
    expect(isOrganizationName("Comité départemental olympique")).toBe(true);
    expect(isOrganizationName("District de football de la Loire")).toBe(true);
    expect(isOrganizationName("Office Municipal des Sports")).toBe(true);
    expect(isOrganizationName("UFOLEP 31")).toBe(true);
  });

  it("ne flagge PAS les vraies installations", () => {
    expect(isOrganizationName("Basic-Fit Toulouse")).toBe(false);
    expect(isOrganizationName("Salle de musculation Jean Moulin")).toBe(false);
    expect(isOrganizationName("Tennis Club de Vincennes")).toBe(false);
    expect(isOrganizationName("Studio Yoga Bastille")).toBe(false);
  });

  it("signal d'installation neutralise le signal org (Salle de la Ligue, District Fitness)", () => {
    expect(isOrganizationName("Salle de la Ligue")).toBe(false);
    expect(isOrganizationName("District Fitness")).toBe(false);
    expect(isOrganizationName("Gymnase du Comité")).toBe(false);
  });

  it("frontière de mot : pas de faux positif sur sous-chaîne", () => {
    // « comite » ⊄ « comitéen »-like ; « ligue » ⊄ « light »… on vérifie le principe
    expect(isOrganizationName("Espace Liguria")).toBe(false);
    expect(isOrganizationName("Districtus Climbing")).toBe(false);
  });

  it("null / vide → false", () => {
    expect(isOrganizationName(null)).toBe(false);
    expect(isOrganizationName(undefined)).toBe(false);
    expect(isOrganizationName("   ")).toBe(false);
  });

  it("pénalise le score d'une org : squelette org passe sous le seuil liste", () => {
    const orgSkeleton: ScorableVenue = {
      name: "Comité départemental de gymnastique",
      address: "1 rue des Sports",
      city_name: "Toulouse",
    };
    // adresse(20)+ville(10)=30 → -30 → 0 < LOW_QUALITY_THRESHOLD
    expect(venueQualityScore(orgSkeleton)).toBe(0);
    expect(isLowQualityVenue(orgSkeleton)).toBe(true);
  });

  it("une org très complète reste visible mais dépriorisée (jamais < 0)", () => {
    const orgRich: ScorableVenue = {
      name: "Ligue régionale de gymnastique",
      address: "1 rue X",
      city_name: "Lyon",
      website_url: "https://ligue.example",
      phone: "0102030405",
      description: "Siège de la ligue.",
    };
    const sameButFacility = { ...orgRich, name: "Gymnase de Lyon" };
    expect(venueQualityScore(orgRich)).toBe(
      venueQualityScore(sameButFacility) - ORGANIZATION_PENALTY
    );
    expect(venueQualityScore({ name: "Ligue X" })).toBe(0);
  });
});
