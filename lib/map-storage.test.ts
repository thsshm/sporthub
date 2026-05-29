import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAutoUpdate,
  loadPickerSeen,
  loadViewport,
  saveAutoUpdate,
  savePickerSeen,
  saveViewport,
} from "@/lib/map-storage";

// Fake localStorage pour env node.
const fakeStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
})();

beforeEach(() => {
  fakeStorage.clear();
  // Injection sur globalThis pour simuler window.localStorage
  vi.stubGlobal("window", { localStorage: fakeStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadViewport", () => {
  it("retourne null si rien en storage", () => {
    expect(loadViewport()).toBeNull();
  });

  it("retourne le viewport sauvé", () => {
    saveViewport({ lat: 48.85, lon: 2.35, zoom: 12 });
    expect(loadViewport()).toEqual({ lat: 48.85, lon: 2.35, zoom: 12 });
  });

  it("retourne null sur JSON invalide", () => {
    fakeStorage.setItem("sporthub-map-viewport", "not-json");
    expect(loadViewport()).toBeNull();
  });

  it("retourne null si lat hors range", () => {
    fakeStorage.setItem(
      "sporthub-map-viewport",
      JSON.stringify({ lat: 999, lon: 0, zoom: 5 }),
    );
    expect(loadViewport()).toBeNull();
  });

  it("retourne null si lon hors range", () => {
    fakeStorage.setItem(
      "sporthub-map-viewport",
      JSON.stringify({ lat: 0, lon: -999, zoom: 5 }),
    );
    expect(loadViewport()).toBeNull();
  });

  it("retourne null si zoom hors range", () => {
    fakeStorage.setItem(
      "sporthub-map-viewport",
      JSON.stringify({ lat: 0, lon: 0, zoom: 99 }),
    );
    expect(loadViewport()).toBeNull();
  });

  it("retourne null si champ manquant", () => {
    fakeStorage.setItem(
      "sporthub-map-viewport",
      JSON.stringify({ lat: 0, lon: 0 }),
    );
    expect(loadViewport()).toBeNull();
  });
});

describe("saveViewport", () => {
  it("sérialise correctement", () => {
    saveViewport({ lat: 1.5, lon: -2.5, zoom: 8 });
    expect(fakeStorage.getItem("sporthub-map-viewport")).toBe(
      '{"lat":1.5,"lon":-2.5,"zoom":8}',
    );
  });
});

describe("loadAutoUpdate / saveAutoUpdate", () => {
  it("retourne le défaut si rien en storage", () => {
    expect(loadAutoUpdate(true)).toBe(true);
    expect(loadAutoUpdate(false)).toBe(false);
  });

  it("retourne true si sauvé true", () => {
    saveAutoUpdate(true);
    expect(loadAutoUpdate(false)).toBe(true);
  });

  it("retourne false si sauvé false", () => {
    saveAutoUpdate(false);
    expect(loadAutoUpdate(true)).toBe(false);
  });

  it("sauve la string 'true' ou 'false'", () => {
    saveAutoUpdate(true);
    expect(fakeStorage.getItem("sporthub-map-auto-update")).toBe("true");
    saveAutoUpdate(false);
    expect(fakeStorage.getItem("sporthub-map-auto-update")).toBe("false");
  });
});

describe("loadPickerSeen / savePickerSeen", () => {
  it("retourne false si rien en storage", () => {
    expect(loadPickerSeen()).toBe(false);
  });

  it("retourne true après savePickerSeen(true)", () => {
    savePickerSeen(true);
    expect(loadPickerSeen()).toBe(true);
  });

  it("retourne false après savePickerSeen(false) (retire la clé)", () => {
    savePickerSeen(true);
    savePickerSeen(false);
    expect(loadPickerSeen()).toBe(false);
    expect(fakeStorage.getItem("sporthub-picker-seen")).toBeNull();
  });

  it("ne traite pas une valeur autre que 'true' comme vue", () => {
    fakeStorage.setItem("sporthub-picker-seen", "false");
    expect(loadPickerSeen()).toBe(false);
  });
});

describe("SSR-safe (window indéfini)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
  });

  it("loadViewport retourne null", () => {
    expect(loadViewport()).toBeNull();
  });

  it("loadAutoUpdate retourne le défaut", () => {
    expect(loadAutoUpdate(true)).toBe(true);
    expect(loadAutoUpdate(false)).toBe(false);
  });

  it("saveViewport ne throw pas", () => {
    expect(() => saveViewport({ lat: 0, lon: 0, zoom: 5 })).not.toThrow();
  });

  it("saveAutoUpdate ne throw pas", () => {
    expect(() => saveAutoUpdate(true)).not.toThrow();
  });

  it("loadPickerSeen retourne false sans window", () => {
    expect(loadPickerSeen()).toBe(false);
  });

  it("savePickerSeen ne throw pas sans window", () => {
    expect(() => savePickerSeen(true)).not.toThrow();
    expect(() => savePickerSeen(false)).not.toThrow();
  });
});
