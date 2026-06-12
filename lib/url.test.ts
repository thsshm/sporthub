import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./url";

describe("safeExternalUrl", () => {
  it("garde les URLs http(s) valides", () => {
    expect(safeExternalUrl("https://exemple.fr/club")).toBe("https://exemple.fr/club");
    expect(safeExternalUrl("http://x.com")).toBe("http://x.com/");
  });
  it("préfixe https:// les domaines nus", () => {
    expect(safeExternalUrl("exemple.fr")).toBe("https://exemple.fr/");
    expect(safeExternalUrl("  tennis-club.fr/lyon  ")).toBe("https://tennis-club.fr/lyon");
  });
  it("rejette les schémas dangereux (XSS)", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>")).toBeNull();
    expect(safeExternalUrl("mailto:a@b.com")).toBeNull();
    expect(safeExternalUrl("ftp://x.com")).toBeNull();
  });
  it("rejette vide / null / non parsable", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl("http://")).toBeNull();
  });
});
