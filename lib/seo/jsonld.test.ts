import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  buildBreadcrumbJsonLd,
  buildCityPlaceJsonLd,
  buildVenuesItemListJsonLd,
  renderJsonLd,
} from "@/lib/seo/jsonld";

describe("absoluteUrl", () => {
  it("retourne l'URL sans préfixe pour le locale par défaut (fr)", () => {
    expect(absoluteUrl("/sports/tennis", "fr")).toBe(
      "https://sporthubmap.com/sports/tennis",
    );
  });

  it("ajoute le préfixe locale pour les locales non-default", () => {
    expect(absoluteUrl("/sports/tennis", "en")).toBe(
      "https://sporthubmap.com/en/sports/tennis",
    );
    expect(absoluteUrl("/sports/tennis", "zh")).toBe(
      "https://sporthubmap.com/zh/sports/tennis",
    );
  });

  it("accepte un path sans slash leading", () => {
    expect(absoluteUrl("sports/tennis")).toBe(
      "https://sporthubmap.com/sports/tennis",
    );
  });

  it("retourne l'URL sans préfixe si pas de locale fourni", () => {
    expect(absoluteUrl("/foo")).toBe("https://sporthubmap.com/foo");
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("produit un BreadcrumbList valide avec positions séquentielles", () => {
    const ld = buildBreadcrumbJsonLd(
      [
        { name: "Home", path: "/" },
        { name: "Tennis", path: "/sports/tennis" },
      ],
      "fr",
    );
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    const items = ld.itemListElement as unknown as Array<{
      "@type": string;
      position: number;
      name: string;
      item: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    expect(items[0].name).toBe("Home");
    expect(items[0].item).toBe("https://sporthubmap.com/");
    expect(items[1].position).toBe(2);
    expect(items[1].item).toBe("https://sporthubmap.com/sports/tennis");
  });

  it("préfixe les URLs pour les locales non-default", () => {
    const ld = buildBreadcrumbJsonLd(
      [{ name: "Tennis", path: "/sports/tennis" }],
      "en",
    );
    const items = ld.itemListElement as unknown as Array<{ item: string }>;
    expect(items[0].item).toBe("https://sporthubmap.com/en/sports/tennis");
  });
});

describe("buildVenuesItemListJsonLd", () => {
  it("produit une ItemList avec URLs venues canoniques", () => {
    const ld = buildVenuesItemListJsonLd(
      [
        { slug: "tennis-club-paris-15", name: "Tennis Club Paris 15" },
        { slug: "padel-marseille-7", name: "Padel Marseille 7" },
      ],
      "fr",
    );
    expect(ld["@type"]).toBe("ItemList");
    const items = ld.itemListElement as unknown as Array<{
      position: number;
      url: string;
      name: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    expect(items[0].url).toBe(
      "https://sporthubmap.com/venue/tennis-club-paris-15",
    );
    expect(items[1].position).toBe(2);
  });

  it("liste vide ne crashe pas", () => {
    const ld = buildVenuesItemListJsonLd([]);
    const items = ld.itemListElement as unknown[];
    expect(items).toHaveLength(0);
  });
});

describe("buildCityPlaceJsonLd", () => {
  it("produit un Place avec PostalAddress", () => {
    const ld = buildCityPlaceJsonLd({
      name: "Paris",
      countryCode: "FR",
    });
    expect(ld["@type"]).toBe("Place");
    expect(ld.name).toBe("Paris");
    const addr = ld.address as unknown as { addressLocality: string; addressCountry: string };
    expect(addr.addressLocality).toBe("Paris");
    expect(addr.addressCountry).toBe("FR");
    expect(ld.geo).toBeUndefined();
  });

  it("inclut geo si lat/lon fournis", () => {
    const ld = buildCityPlaceJsonLd({
      name: "Paris",
      countryCode: "FR",
      lat: 48.8566,
      lon: 2.3522,
    });
    const geo = ld.geo as unknown as { latitude: number; longitude: number };
    expect(geo.latitude).toBe(48.8566);
    expect(geo.longitude).toBe(2.3522);
  });

  it("omet geo si lat ou lon null", () => {
    const ld = buildCityPlaceJsonLd({
      name: "Paris",
      countryCode: "FR",
      lat: null,
      lon: null,
    });
    expect(ld.geo).toBeUndefined();
  });
});

describe("renderJsonLd", () => {
  it("produit un élément script avec application/ld+json", () => {
    const el = renderJsonLd({ "@type": "Thing", name: "x" });
    expect(el.type).toBe("script");
    const props = el.props as {
      type: string;
      dangerouslySetInnerHTML: { __html: string };
    };
    expect(props.type).toBe("application/ld+json");
    expect(props.dangerouslySetInnerHTML.__html).toContain('"@type":"Thing"');
  });

  it("échappe les < pour prévenir une injection </script>", () => {
    const el = renderJsonLd({ "@type": "Thing", name: "a</script>b" });
    const props = el.props as { dangerouslySetInnerHTML: { __html: string } };
    expect(props.dangerouslySetInnerHTML.__html).not.toContain("</script>");
    expect(props.dangerouslySetInnerHTML.__html).toContain("\\u003c/script");
  });
});
