import { describe, it, expect } from "vitest";
import {
  buildPartnerRedirectUrl,
  hashIp,
  clientIpFromHeader,
  type PartnerForRedirect,
} from "./partners";

const anybuddy: PartnerForRedirect = {
  slug: "anybuddy",
  base_url_template: "https://anybuddy.com/clubs/{slug}",
  affiliate_id: null,
};

describe("buildPartnerRedirectUrl", () => {
  it("substitue {slug} et ajoute les UTM", () => {
    const url = buildPartnerRedirectUrl(anybuddy, "tennis-club-paris-15");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://anybuddy.com/clubs/tennis-club-paris-15",
    );
    expect(parsed.searchParams.get("utm_source")).toBe("sporthub");
    expect(parsed.searchParams.get("utm_medium")).toBe("referral");
    expect(parsed.searchParams.get("utm_campaign")).toBe("anybuddy");
    expect(parsed.searchParams.get("utm_content")).toBe("tennis-club-paris-15");
  });

  it("substitue {affiliate_id} quand présent", () => {
    const partner: PartnerForRedirect = {
      slug: "playtomic",
      base_url_template: "https://playtomic.io/v/{slug}?aff={affiliate_id}",
      affiliate_id: "SPORTHUB42",
    };
    const url = buildPartnerRedirectUrl(partner, "padel-lyon");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("aff")).toBe("SPORTHUB42");
  });

  it("remplace {affiliate_id} par une chaîne vide si aucun deal signé", () => {
    const partner: PartnerForRedirect = {
      slug: "classpass",
      base_url_template: "https://classpass.com/s/{slug}?aff={affiliate_id}",
      affiliate_id: null,
    };
    const parsed = new URL(buildPartnerRedirectUrl(partner, "gym-x"));
    expect(parsed.searchParams.get("aff")).toBe("");
  });

  it("préserve la query string existante du template", () => {
    const partner: PartnerForRedirect = {
      slug: "mindbody",
      base_url_template: "https://mindbody.com/explore?q={slug}",
      affiliate_id: null,
    };
    const parsed = new URL(buildPartnerRedirectUrl(partner, "yoga-nice"));
    expect(parsed.searchParams.get("q")).toBe("yoga-nice");
    expect(parsed.searchParams.get("utm_source")).toBe("sporthub");
  });

  it("URL-encode les slugs à caractères spéciaux", () => {
    const parsed = new URL(buildPartnerRedirectUrl(anybuddy, "café-dé? test"));
    // Le pathname encode les caractères non-ASCII / réservés.
    expect(parsed.pathname).toContain("caf%C3%A9");
    expect(parsed.pathname).not.toContain(" ");
  });

  it("n'écrase pas un utm_source déjà fixé en double (set idempotent)", () => {
    const partner: PartnerForRedirect = {
      slug: "superprof",
      base_url_template: "https://superprof.fr/{slug}?utm_source=legacy",
      affiliate_id: null,
    };
    const parsed = new URL(buildPartnerRedirectUrl(partner, "coach"));
    // une seule valeur, la nôtre
    expect(parsed.searchParams.getAll("utm_source")).toEqual(["sporthub"]);
  });

  it("throw si le template ne donne pas une URL absolue", () => {
    const bad: PartnerForRedirect = {
      slug: "broken",
      base_url_template: "/clubs/{slug}",
      affiliate_id: null,
    };
    expect(() => buildPartnerRedirectUrl(bad, "x")).toThrow();
  });
});

describe("hashIp", () => {
  it("retourne un SHA-256 hex de 64 caractères", () => {
    const h = hashIp("203.0.113.7", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
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
