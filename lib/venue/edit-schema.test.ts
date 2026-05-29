import { describe, expect, it } from "vitest";
import { venueEditSchema } from "@/lib/venue/edit-schema";

describe("venueEditSchema", () => {
  it("accepte un input minimal valide (juste name)", () => {
    const r = venueEditSchema.safeParse({
      name: "Stade Charléty",
      description: "",
      website_url: "",
      phone: "",
      address: "",
      postal_code: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Stade Charléty");
      expect(r.data.description).toBeNull();
      expect(r.data.website_url).toBeNull();
      expect(r.data.phone).toBeNull();
      expect(r.data.address).toBeNull();
      expect(r.data.postal_code).toBeNull();
    }
  });

  it("rejette un name vide", () => {
    const r = venueEditSchema.safeParse({
      name: "",
      description: "",
      website_url: "",
      phone: "",
      address: "",
      postal_code: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "name")?.message;
      expect(msg).toBe("name_required");
    }
  });

  it("rejette un name uniquement composé d'espaces", () => {
    const r = venueEditSchema.safeParse({
      name: "   ",
      description: "",
      website_url: "",
      phone: "",
      address: "",
      postal_code: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejette une URL invalide", () => {
    const r = venueEditSchema.safeParse({
      name: "X",
      description: "",
      website_url: "not-a-url",
      phone: "",
      address: "",
      postal_code: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find(
        (i) => i.path[0] === "website_url",
      )?.message;
      expect(msg).toBe("website_invalid");
    }
  });

  it("accepte une URL http et https", () => {
    for (const url of ["http://example.com", "https://foo.bar/baz?q=1"]) {
      const r = venueEditSchema.safeParse({
        name: "X",
        description: "",
        website_url: url,
        phone: "",
        address: "",
        postal_code: "",
      });
      expect(r.success).toBe(true);
    }
  });

  it("trim les valeurs string", () => {
    const r = venueEditSchema.safeParse({
      name: "  Spot  ",
      description: "  desc  ",
      website_url: "",
      phone: "  +33 1 ",
      address: " 12 rue X ",
      postal_code: " 75013 ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Spot");
      expect(r.data.description).toBe("desc");
      expect(r.data.phone).toBe("+33 1");
      expect(r.data.address).toBe("12 rue X");
      expect(r.data.postal_code).toBe("75013");
    }
  });

  it("rejette un name trop long", () => {
    const r = venueEditSchema.safeParse({
      name: "x".repeat(201),
      description: "",
      website_url: "",
      phone: "",
      address: "",
      postal_code: "",
    });
    expect(r.success).toBe(false);
  });
});
