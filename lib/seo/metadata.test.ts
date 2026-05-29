import { describe, expect, it } from "vitest";
import type { VenueDetail } from "@/lib/supabase/types";
import {
  buildHomeMetadata,
  buildVenueJsonLd,
  buildVenueMetadata,
  buildWebsiteJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";

// Factory pour générer un venue de test minimal complet.
function makeVenue(overrides: Partial<VenueDetail> = {}): VenueDetail {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "tennis-club-paris-15",
    name: "Tennis Club Paris 15",
    description: null,
    lat: 48.8566,
    lon: 2.3522,
    address: "Rue de Test",
    city_id: null,
    postal_code: "75015",
    country_code: "FR",
    website_url: null,
    phone: "+33102030405",
    email: null,
    family_slug: "raquette",
    primary_sport_slug: "tennis",
    is_indoor: false,
    has_lighting: null,
    is_wheelchair_accessible: null,
    courts_count: null,
    capacity: null,
    fee_required: null,
    price_range: null,
    source: "osm",
    external_id: null,
    enrichments: {},
    claimed_by: null,
    claim_status: "unclaimed",
    is_published: true,
    deleted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildHomeMetadata", () => {
  const meta = buildHomeMetadata();

  it("définit un title template pour les enfants", () => {
    expect(typeof meta.title).toBe("object");
    if (meta.title && typeof meta.title === "object" && "template" in meta.title) {
      expect(meta.title.template).toContain("Sport Hub");
    }
  });

  it("a un canonical /", () => {
    expect(meta.alternates?.canonical).toBe("/");
  });

  it("inclut une image OG par défaut", () => {
    expect(meta.openGraph?.images).toBeDefined();
  });

  it("metadataBase pointe vers le domaine prod", () => {
    expect(meta.metadataBase?.toString()).toContain("sporthubmap.com");
  });
});

describe("buildVenueMetadata", () => {
  it("titre inclut le nom du venue + city", () => {
    const meta = buildVenueMetadata(makeVenue(), "Paris");
    expect(meta.title).toContain("Tennis Club Paris 15");
    expect(meta.title).toContain("Paris");
  });

  it("titre fonctionne sans cityName (fallback address)", () => {
    const meta = buildVenueMetadata(makeVenue());
    expect(meta.title).toContain("Rue de Test");
  });

  it("description fallback est générée si null", () => {
    const meta = buildVenueMetadata(makeVenue({ description: null }), "Paris");
    expect(meta.description).toContain("Tennis Club Paris 15");
    expect(meta.description).toContain("Paris");
  });

  it("description utilise la description venue si présente", () => {
    const meta = buildVenueMetadata(
      makeVenue({ description: "Club historique du 15e." }),
    );
    expect(meta.description).toBe("Club historique du 15e.");
  });

  it("canonical pointe vers /venue/[slug]", () => {
    const meta = buildVenueMetadata(makeVenue({ slug: "padel-marseille-7" }));
    expect(meta.alternates?.canonical).toBe("/venue/padel-marseille-7");
  });

  it("utilise photo_url de enrichments comme image OG si disponible", () => {
    const meta = buildVenueMetadata(
      makeVenue({ enrichments: { photo_url: "https://example.com/photo.jpg" } }),
    );
    const og = meta.openGraph;
    if (og?.images && Array.isArray(og.images)) {
      const first = og.images[0];
      if (typeof first === "object" && first && "url" in first) {
        expect(String(first.url)).toBe("https://example.com/photo.jpg");
      }
    }
  });
});

describe("buildVenueJsonLd", () => {
  it("retourne un objet schema.org SportsActivityLocation", () => {
    const ld = buildVenueJsonLd(makeVenue(), "Paris") as Record<string, unknown>;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("SportsActivityLocation");
    expect(ld["name"]).toBe("Tennis Club Paris 15");
  });

  it("inclut geo lat/lon", () => {
    const ld = buildVenueJsonLd(makeVenue()) as Record<string, unknown>;
    const geo = ld["geo"] as { latitude: number; longitude: number };
    expect(geo.latitude).toBe(48.8566);
    expect(geo.longitude).toBe(2.3522);
  });

  it("inclut aggregateRating si google_rating présent", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        enrichments: { google_rating: 4.6, google_rating_count: 123 },
      }),
    ) as Record<string, unknown>;
    const rating = ld["aggregateRating"] as Record<string, unknown>;
    expect(rating).toBeDefined();
    expect(rating["ratingValue"]).toBe(4.6);
    expect(rating["reviewCount"]).toBe(123);
  });

  it("omet aggregateRating si pas de google_rating", () => {
    const ld = buildVenueJsonLd(makeVenue()) as Record<string, unknown>;
    expect(ld["aggregateRating"]).toBeUndefined();
  });

  it("inclut sameAs Wikipedia si présent", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        enrichments: { wikipedia_url: "https://fr.wikipedia.org/wiki/X" },
      }),
    ) as Record<string, unknown>;
    expect(ld["sameAs"]).toEqual(["https://fr.wikipedia.org/wiki/X"]);
  });

  it("inclut image depuis enrichments.photo_url", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        enrichments: { photo_url: "https://example.com/p.jpg" },
      }),
    ) as Record<string, unknown>;
    expect(ld["image"]).toBe("https://example.com/p.jpg");
  });

  it("inclut priceRange si venue.price_range présent", () => {
    const ld = buildVenueJsonLd(
      makeVenue({ price_range: "€€" }),
    ) as Record<string, unknown>;
    expect(ld["priceRange"]).toBe("€€");
  });

  it("omet priceRange si absent", () => {
    const ld = buildVenueJsonLd(makeVenue()) as Record<string, unknown>;
    expect(ld["priceRange"]).toBeUndefined();
  });

  it("inclut amenityFeature pour les flags scalaires true", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        is_indoor: true,
        has_lighting: true,
        is_wheelchair_accessible: true,
      }),
    ) as Record<string, unknown>;
    const features = ld["amenityFeature"] as Array<Record<string, unknown>>;
    expect(features).toHaveLength(3);
    expect(features[0]["@type"]).toBe("LocationFeatureSpecification");
  });

  it("omet amenityFeature si aucun flag true", () => {
    const ld = buildVenueJsonLd(makeVenue()) as Record<string, unknown>;
    expect(ld["amenityFeature"]).toBeUndefined();
  });

  it("inclut openingHoursSpecification quand raw_tags.opening_hours est parsable", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        enrichments: {
          raw_tags: { opening_hours: "Mo-Fr 09:00-22:00" },
        },
      }),
    ) as Record<string, unknown>;
    const ohs = ld["openingHoursSpecification"] as Array<Record<string, unknown>>;
    expect(ohs).toHaveLength(5);
    expect(ohs[0]["dayOfWeek"]).toBe("Monday");
  });

  it("omet openingHoursSpecification quand format non parsable", () => {
    const ld = buildVenueJsonLd(
      makeVenue({
        enrichments: { raw_tags: { opening_hours: "PH off; sunset" } },
      }),
    ) as Record<string, unknown>;
    expect(ld["openingHoursSpecification"]).toBeUndefined();
  });
});

describe("buildWebsiteJsonLd", () => {
  it("retourne un objet schema.org WebSite avec SearchAction", () => {
    const ld = buildWebsiteJsonLd() as Record<string, unknown>;
    expect(ld["@type"]).toBe("WebSite");
    expect(ld["url"]).toContain("sporthubmap.com");
    const action = ld["potentialAction"] as { "@type": string };
    expect(action["@type"]).toBe("SearchAction");
  });
});

describe("jsonLdHtml", () => {
  it("produit un JSON valide pour des données normales", () => {
    const html = jsonLdHtml({ "@type": "Thing", name: "Tennis Club" });
    expect(JSON.parse(html)).toEqual({ "@type": "Thing", name: "Tennis Club" });
  });

  it("échappe `<` pour empêcher une rupture de balise </script> (XSS)", () => {
    const html = jsonLdHtml({
      "@type": "Place",
      name: "Evil</script><script>alert(1)</script>",
    });
    // Aucun `<` littéral ne doit subsister dans la sortie injectée.
    expect(html).not.toContain("<");
    expect(html).toContain("\\u003c");
    // Reste un JSON-LD valide une fois parsé.
    const parsed = JSON.parse(html) as { name: string };
    expect(parsed.name).toBe("Evil</script><script>alert(1)</script>");
  });
});
