import { describe, expect, it } from "vitest";
import { sportActionKey } from "@/lib/seo/sport-action";

describe("sportActionKey", () => {
  it("surcharge par sport prioritaire sur la famille", () => {
    // spa/sauna/hammam sont dans la famille yoga (Bien-être) mais → relax
    expect(sportActionKey("yoga", "spa")).toBe("relax");
    expect(sportActionKey("yoga", "sauna")).toBe("relax");
    expect(sportActionKey("yoga", "hammam")).toBe("relax");
    // yoga / méditation → practice
    expect(sportActionKey("yoga", "yoga")).toBe("practice");
    expect(sportActionKey("yoga", "meditation")).toBe("practice");
  });

  it("défaut par famille", () => {
    expect(sportActionKey("fitness", "gym")).toBe("train");
    expect(sportActionKey("combat", "judo")).toBe("train");
    expect(sportActionKey("retraites", "yoga_retreat")).toBe("retreat");
    expect(sportActionKey("baignade", "pool")).toBe("swim");
  });

  it("play par défaut (ballon, raquette, etc.)", () => {
    expect(sportActionKey("ballon", "football")).toBe("play");
    expect(sportActionKey("raquette", "tennis")).toBe("play");
    expect(sportActionKey("boules", "petanque")).toBe("play");
    expect(sportActionKey("glisse", "surf")).toBe("play");
  });

  it("robuste aux valeurs absentes", () => {
    expect(sportActionKey(null, null)).toBe("play");
    expect(sportActionKey(undefined, undefined)).toBe("play");
    expect(sportActionKey("famille_inconnue", "sport_inconnu")).toBe("play");
  });
});
