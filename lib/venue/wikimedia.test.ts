import { describe, it, expect } from "vitest";
import { wikimediaThumb, truncate } from "./wikimedia";

describe("wikimediaThumb", () => {
  it("returns null when url is null/undefined/empty", () => {
    expect(wikimediaThumb(null, 200)).toBeNull();
    expect(wikimediaThumb(undefined, 200)).toBeNull();
    expect(wikimediaThumb("", 200)).toBeNull();
  });

  it("returns null when url is malformed", () => {
    expect(wikimediaThumb("not a url", 200)).toBeNull();
  });

  it("converts upload.wikimedia.org URL to Special:FilePath with width", () => {
    const original =
      "https://upload.wikimedia.org/wikipedia/commons/3/3d/Stade_Roland_Garros.jpg";
    const result = wikimediaThumb(original, 320);
    expect(result).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Stade_Roland_Garros.jpg?width=320",
    );
  });

  it("updates width on existing Special:FilePath URL", () => {
    const original =
      "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.png?width=100";
    expect(wikimediaThumb(original, 800)).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.png?width=800",
    );
  });

  it("adds width param when Special:FilePath has none", () => {
    const original =
      "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.png";
    expect(wikimediaThumb(original, 160)).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.png?width=160",
    );
  });

  it("returns non-wikimedia URLs unchanged (fallback gracieux)", () => {
    const original = "https://example.com/img.jpg";
    expect(wikimediaThumb(original, 200)).toBe(original);
  });
});

describe("truncate", () => {
  it("returns empty string for null/undefined", () => {
    expect(truncate(null, 100)).toBe("");
    expect(truncate(undefined, 100)).toBe("");
  });

  it("returns text unchanged when shorter than max", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });

  it("trims whitespace before measuring length", () => {
    expect(truncate("   hi   ", 100)).toBe("hi");
  });

  it("truncates at word boundary with ellipsis", () => {
    const text =
      "Le stade Roland-Garros est un complexe sportif parisien dédié au tennis";
    const out = truncate(text, 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    // Le helper coupe à un espace : le mot juste avant l'ellipse doit donc
    // être présent dans le texte d'origine en tant que mot complet.
    const truncatedWord = out.replace(/…$/, "").trim().split(" ").pop() ?? "";
    expect(text).toMatch(new RegExp(`\\b${truncatedWord}\\b`));
  });

  it("falls back to hard cut when no late space exists", () => {
    const text = "supercalifragilisticexpialidocious-foo-bar";
    const out = truncate(text, 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(11);
  });
});
