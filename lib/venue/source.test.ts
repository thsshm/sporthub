import { describe, expect, it } from "vitest";
import { getVenueSourceMeta } from "./source";

describe("getVenueSourceMeta", () => {
  it("maps known open sources (case-insensitive)", () => {
    expect(getVenueSourceMeta("osm")?.label).toBe("OpenStreetMap");
    expect(getVenueSourceMeta("OSM")?.label).toBe("OpenStreetMap");
    expect(getVenueSourceMeta("openstreetmap")?.key).toBe("osm");
    expect(getVenueSourceMeta("res")?.label).toBe("RES (Ministère des Sports)");
    expect(getVenueSourceMeta("wikidata")?.label).toBe("Wikidata");
    expect(getVenueSourceMeta("overture")?.label).toBe("Overture Maps");
  });

  it("trims whitespace", () => {
    expect(getVenueSourceMeta("  osm  ")?.key).toBe("osm");
  });

  it("returns null for unknown / internal / empty sources", () => {
    expect(getVenueSourceMeta("hyrox")).toBeNull();
    expect(getVenueSourceMeta("v1")).toBeNull();
    expect(getVenueSourceMeta("")).toBeNull();
    expect(getVenueSourceMeta(null)).toBeNull();
    expect(getVenueSourceMeta(undefined)).toBeNull();
  });

  it("exposes a url for known sources", () => {
    expect(getVenueSourceMeta("osm")?.url).toContain("openstreetmap.org");
    expect(getVenueSourceMeta("overture")?.url).toContain("overturemaps.org");
  });
});
