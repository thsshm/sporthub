import { describe, expect, it } from "vitest";
import { buildAffiliateUrl, AFFILIATE_UTM } from "./affiliate";

const ctx = { venueId: "venue-123", partner: "Anybuddy", source: "venue_page" };

describe("buildAffiliateUrl", () => {
  it("ajoute les UTM SportHub à une URL partenaire nue", () => {
    const out = new URL(buildAffiliateUrl("https://anybuddy.fr/club/42", ctx));
    expect(out.searchParams.get("utm_source")).toBe(AFFILIATE_UTM.source);
    expect(out.searchParams.get("utm_medium")).toBe(AFFILIATE_UTM.medium);
    expect(out.searchParams.get("utm_campaign")).toBe(AFFILIATE_UTM.campaign);
    expect(out.searchParams.get("utm_content")).toBe("Anybuddy");
    expect(out.searchParams.get("utm_term")).toBe("venue-123");
    expect(out.searchParams.get("shub_src")).toBe("venue_page");
  });

  it("préserve les query params existants du partenaire", () => {
    const out = new URL(
      buildAffiliateUrl("https://anybuddy.fr/club/42?ref=abc&lang=fr", ctx),
    );
    expect(out.searchParams.get("ref")).toBe("abc");
    expect(out.searchParams.get("lang")).toBe("fr");
    expect(out.searchParams.get("utm_source")).toBe(AFFILIATE_UTM.source);
  });

  it("n'écrase pas un utm_* déjà posé par le partenaire", () => {
    const out = new URL(
      buildAffiliateUrl("https://anybuddy.fr/c?utm_source=partner_own", ctx),
    );
    expect(out.searchParams.get("utm_source")).toBe("partner_own");
    // les autres utm absents sont quand même ajoutés
    expect(out.searchParams.get("utm_campaign")).toBe(AFFILIATE_UTM.campaign);
  });

  it("préserve le fragment", () => {
    const out = buildAffiliateUrl("https://anybuddy.fr/c#booking", ctx);
    expect(out).toContain("#booking");
  });

  it("omet shub_src quand source n'est pas fournie", () => {
    const out = new URL(
      buildAffiliateUrl("https://anybuddy.fr/c", {
        venueId: "v1",
        partner: "P",
      }),
    );
    expect(out.searchParams.has("shub_src")).toBe(false);
  });

  it("renvoie l'URL telle quelle si elle est invalide", () => {
    expect(buildAffiliateUrl("pas-une-url", ctx)).toBe("pas-une-url");
  });

  it("n'ajoute pas deux fois le même utm en cas d'appel idempotent", () => {
    const once = buildAffiliateUrl("https://anybuddy.fr/c", ctx);
    const twice = buildAffiliateUrl(once, ctx);
    expect(twice).toBe(once);
  });
});
