import { describe, expect, it } from "vitest";
import {
  buildAffiliateUrl,
  AFFILIATE_UTM,
  hashIp,
  clientIpFromHeader,
  normalizePartnerSlug,
} from "./affiliate";

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

describe("hashIp", () => {
  it("retourne un SHA-256 hex de 64 caractères", () => {
    expect(hashIp("203.0.113.7", "salt")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("est déterministe pour le même couple ip+salt", () => {
    expect(hashIp("1.2.3.4", "s")).toBe(hashIp("1.2.3.4", "s"));
  });

  it("change avec le sel (non ré-identifiable par dictionnaire)", () => {
    expect(hashIp("1.2.3.4", "saltA")).not.toBe(hashIp("1.2.3.4", "saltB"));
  });

  it("ne stocke jamais l'IP en clair dans le hash", () => {
    const ip = "198.51.100.23";
    expect(hashIp(ip, "salt")).not.toContain(ip);
  });

  it("retourne null si l'IP est absente", () => {
    expect(hashIp(null, "salt")).toBeNull();
    expect(hashIp(undefined, "salt")).toBeNull();
    expect(hashIp("", "salt")).toBeNull();
  });
});

describe("clientIpFromHeader", () => {
  it("extrait la première IP d'une chaîne x-forwarded-for", () => {
    expect(clientIpFromHeader("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe(
      "203.0.113.7",
    );
  });

  it("gère une IP unique sans virgule", () => {
    expect(clientIpFromHeader("203.0.113.7")).toBe("203.0.113.7");
  });

  it("retourne null si le header est absent ou vide", () => {
    expect(clientIpFromHeader(null)).toBeNull();
    expect(clientIpFromHeader("")).toBeNull();
    expect(clientIpFromHeader("   ")).toBeNull();
  });
});

describe("normalizePartnerSlug", () => {
  it("mappe les 8 partenaires seedés (0012) sur leur slug canonique", () => {
    expect(normalizePartnerSlug("Anybuddy")).toBe("anybuddy");
    expect(normalizePartnerSlug("ClassPass")).toBe("classpass");
    expect(normalizePartnerSlug("Mindbody")).toBe("mindbody");
    expect(normalizePartnerSlug("Playtomic")).toBe("playtomic");
    expect(normalizePartnerSlug("Surf-Forecast")).toBe("surf-forecast");
    expect(normalizePartnerSlug("Kitesurf Schools")).toBe("kitesurf-schools");
    expect(normalizePartnerSlug("Superprof")).toBe("superprof");
    expect(normalizePartnerSlug("BookYogaRetreats")).toBe("bookyogaretreats");
  });

  it("collapse espaces, casse et caractères spéciaux en un slug propre", () => {
    expect(normalizePartnerSlug("  Foo   Bar  ")).toBe("foo-bar");
    expect(normalizePartnerSlug("A&B / C")).toBe("a-b-c");
    expect(normalizePartnerSlug("Été Sport")).toBe("ete-sport"); // accents retirés
  });

  it("retourne null pour une entrée vide/nullish", () => {
    expect(normalizePartnerSlug("")).toBeNull();
    expect(normalizePartnerSlug("   ")).toBeNull();
    expect(normalizePartnerSlug("---")).toBeNull();
    expect(normalizePartnerSlug(null)).toBeNull();
    expect(normalizePartnerSlug(undefined)).toBeNull();
  });
});
