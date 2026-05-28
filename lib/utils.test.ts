import { describe, expect, it } from "vitest";
import {
  appleMapsUrl,
  cn,
  formatCount,
  googleMapsUrl,
  truncate,
  wazeUrl,
  whatsappShareUrl,
} from "@/lib/utils";

describe("cn — Tailwind class merger", () => {
  it("concatène les classes simples", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("ignore falsy values", () => {
    expect(cn("foo", false, null, undefined, "", "bar")).toBe("foo bar");
  });

  it("résout les conflits Tailwind (twMerge)", () => {
    // Si twMerge fonctionne, p-2 doit gagner sur p-4 (dernier wins)
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("gère un tableau imbriqué (clsx)", () => {
    expect(cn(["foo", ["bar", "baz"]])).toBe("foo bar baz");
  });
});

describe("formatCount", () => {
  it("ajoute le séparateur de milliers français", () => {
    // toLocaleString utilise   (narrow no-break space) en fr-FR
    expect(formatCount(1000)).toBe("1 000");
    expect(formatCount(267000)).toBe("267 000");
  });

  it("ne touche pas aux petits nombres", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(42)).toBe("42");
  });

  it("formate les nombres négatifs", () => {
    expect(formatCount(-1000)).toBe("-1 000");
  });
});

describe("truncate", () => {
  it("ne touche pas un texte plus court que maxLength", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("tronque et ajoute une ellipse", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });

  it("trim les espaces avant l'ellipse", () => {
    expect(truncate("hello world", 6)).toBe("hello…");
  });

  it("gère exactement maxLength = longueur (pas de coupe)", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("googleMapsUrl", () => {
  it("utilise le nom encodé si fourni", () => {
    const url = googleMapsUrl(48.8566, 2.3522, "Tour Eiffel");
    expect(url).toContain("query=Tour%20Eiffel");
    expect(url).toContain("query_place_id=48.8566,2.3522");
  });

  it("fallback sur lat,lon si pas de nom", () => {
    const url = googleMapsUrl(48.8566, 2.3522);
    expect(url).toContain("query=48.8566,2.3522");
  });

  it("encode les caractères spéciaux du nom", () => {
    const url = googleMapsUrl(45.75, 4.85, "Café & Thé");
    expect(url).toContain("Caf%C3%A9%20%26%20Th%C3%A9");
  });
});

describe("appleMapsUrl", () => {
  it("construit une URL avec lat/lon", () => {
    expect(appleMapsUrl(48.8566, 2.3522)).toBe(
      "https://maps.apple.com/?q=&ll=48.8566,2.3522",
    );
  });

  it("inclut le nom encodé si fourni", () => {
    const url = appleMapsUrl(48.8566, 2.3522, "Tour Eiffel");
    expect(url).toContain("q=Tour%20Eiffel");
  });
});

describe("wazeUrl", () => {
  it("active la navigation", () => {
    expect(wazeUrl(48.8566, 2.3522)).toBe(
      "https://waze.com/ul?ll=48.8566,2.3522&navigate=yes",
    );
  });
});

describe("whatsappShareUrl", () => {
  it("encode le texte et l'URL ensemble", () => {
    const url = whatsappShareUrl("Check this", "https://sporthubmap.com/x");
    expect(url).toContain("text=Check%20this%20https");
  });

  it("encode les caractères spéciaux", () => {
    const url = whatsappShareUrl("café & co", "https://x.com");
    expect(url).toContain("caf%C3%A9");
  });
});
