import { describe, it, expect } from "vitest";
import { parseVercelGeo } from "./ip-geo";

/** Construit un accesseur de header depuis un objet plat. */
function headers(map: Record<string, string>): (n: string) => string | null {
  return (name) => (name in map ? map[name] : null);
}

describe("parseVercelGeo", () => {
  it("parse une géoloc Vercel complète", () => {
    const geo = parseVercelGeo(
      headers({
        "x-vercel-ip-latitude": "48.8566",
        "x-vercel-ip-longitude": "2.3522",
        "x-vercel-ip-city": "Paris",
        "x-vercel-ip-country": "fr",
      }),
    );
    expect(geo).toEqual({ lat: 48.8566, lon: 2.3522, city: "Paris", country: "FR" });
  });

  it("décode les villes URL-encodées", () => {
    const geo = parseVercelGeo(
      headers({
        "x-vercel-ip-latitude": "37.7749",
        "x-vercel-ip-longitude": "-122.4194",
        "x-vercel-ip-city": "San%20Francisco",
      }),
    );
    expect(geo?.city).toBe("San Francisco");
    expect(geo?.country).toBeNull();
  });

  it("retourne null si lat/lon absents (dev local sans headers Vercel)", () => {
    expect(parseVercelGeo(headers({}))).toBeNull();
    expect(parseVercelGeo(headers({ "x-vercel-ip-latitude": "48.8" }))).toBeNull();
  });

  it("rejette les coordonnées hors bornes ou non numériques", () => {
    expect(
      parseVercelGeo(headers({ "x-vercel-ip-latitude": "999", "x-vercel-ip-longitude": "2" })),
    ).toBeNull();
    expect(
      parseVercelGeo(headers({ "x-vercel-ip-latitude": "48", "x-vercel-ip-longitude": "200" })),
    ).toBeNull();
    expect(
      parseVercelGeo(headers({ "x-vercel-ip-latitude": "abc", "x-vercel-ip-longitude": "2" })),
    ).toBeNull();
  });

  it("écarte Null Island (0,0)", () => {
    expect(
      parseVercelGeo(headers({ "x-vercel-ip-latitude": "0", "x-vercel-ip-longitude": "0" })),
    ).toBeNull();
  });

  it("accepte une géoloc sans ville", () => {
    const geo = parseVercelGeo(
      headers({ "x-vercel-ip-latitude": "51.5", "x-vercel-ip-longitude": "-0.12" }),
    );
    expect(geo).toEqual({ lat: 51.5, lon: -0.12, city: null, country: null });
  });

  it("traite une ville vide comme absente", () => {
    const geo = parseVercelGeo(
      headers({
        "x-vercel-ip-latitude": "45.0",
        "x-vercel-ip-longitude": "5.0",
        "x-vercel-ip-city": "",
      }),
    );
    expect(geo?.city).toBeNull();
  });
});
