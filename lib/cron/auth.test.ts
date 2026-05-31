import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeEqual, verifyCronAuth } from "./auth";

describe("safeEqual", () => {
  it("vrai pour deux chaînes identiques", () => {
    expect(safeEqual("Bearer abc123", "Bearer abc123")).toBe(true);
  });

  it("faux pour des chaînes de même longueur mais différentes", () => {
    expect(safeEqual("Bearer abc123", "Bearer abc124")).toBe(false);
  });

  it("faux pour des longueurs différentes (sans throw)", () => {
    expect(safeEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("gère les chaînes vides", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("gère l'unicode multi-octets sans throw", () => {
    expect(safeEqual("clé-é", "clé-é")).toBe(true);
    expect(safeEqual("clé-é", "cle-e")).toBe(false);
  });
});

describe("verifyCronAuth", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cr3t-test";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const req = (auth?: string) =>
    new Request("https://x/api/cron/x", {
      headers: auth ? { authorization: auth } : {},
    });

  it("null (OK) avec le bon Bearer", () => {
    expect(verifyCronAuth(req("Bearer s3cr3t-test"))).toBeNull();
  });

  it("401 avec un mauvais secret", () => {
    const res = verifyCronAuth(req("Bearer wrong"));
    expect(res?.response.status).toBe(401);
  });

  it("401 sans header", () => {
    expect(verifyCronAuth(req())?.response.status).toBe(401);
  });

  it("500 si CRON_SECRET absent (fail-closed)", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronAuth(req("Bearer whatever"))?.response.status).toBe(500);
  });
});
