import { describe, expect, it } from "vitest";
import { hasWebGLContext } from "@/lib/webgl";

describe("hasWebGLContext", () => {
  it("vrai si un type renvoie un contexte", () => {
    expect(hasWebGLContext((t) => (t === "webgl" ? {} : null))).toBe(true);
    expect(hasWebGLContext((t) => (t === "webgl2" ? {} : null))).toBe(true);
    expect(hasWebGLContext((t) => (t === "experimental-webgl" ? {} : null))).toBe(true);
  });

  it("faux si tous les types renvoient null", () => {
    expect(hasWebGLContext(() => null)).toBe(false);
  });

  it("ignore un type qui lève et essaie les suivants", () => {
    const get = (t: string) => {
      if (t === "webgl2") throw new Error("non supporté");
      return t === "webgl" ? {} : null;
    };
    expect(hasWebGLContext(get)).toBe(true);
  });

  it("faux si tous les types lèvent", () => {
    expect(
      hasWebGLContext(() => {
        throw new Error("bloqué");
      }),
    ).toBe(false);
  });
});
