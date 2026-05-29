import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock du client browser : `resolveSlugsToIds` l'importe dynamiquement
// pour résoudre les slugs en uuids.
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: "11111111-1111-1111-1111-111111111111", slug: "padel-paris" },
            { id: "22222222-2222-2222-2222-222222222222", slug: "tennis-lyon" },
          ],
          error: null,
        }),
      }),
    }),
  }),
}));

import { syncLocalFavoritesToServer } from "@/lib/favorites-sync";

const FAVORITES_KEY = "sporthub-favorites";

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
  vi.stubGlobal("window", { localStorage: fakeStorage });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncLocalFavoritesToServer", () => {
  it("retourne un récap vide si pas de favoris locaux", async () => {
    const res = await syncLocalFavoritesToServer();
    expect(res).toEqual({
      total: 0,
      posted: 0,
      skipped: 0,
      failed: 0,
      cleared: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("poste les UUID directement et clear le localStorage en cas de succès", async () => {
    fakeStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify([
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ]),
    );
    const res = await syncLocalFavoritesToServer();
    expect(res.posted).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.cleared).toBe(true);
    expect(fakeStorage.getItem(FAVORITES_KEY)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("résout les slugs (legacy V1) vers leurs UUID via Supabase", async () => {
    fakeStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify(["padel-paris", "tennis-lyon"]),
    );
    const res = await syncLocalFavoritesToServer();
    expect(res.total).toBe(2);
    expect(res.posted).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.cleared).toBe(true);
  });

  it("skip les slugs inconnus sans planter", async () => {
    fakeStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify(["padel-paris", "slug-inconnu-xyz"]),
    );
    const res = await syncLocalFavoritesToServer();
    expect(res.posted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.cleared).toBe(true);
  });

  it("ne clear PAS le localStorage si au moins un POST a échoué", async () => {
    fakeStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const res = await syncLocalFavoritesToServer();
    expect(res.failed).toBe(1);
    expect(res.cleared).toBe(false);
    expect(fakeStorage.getItem(FAVORITES_KEY)).not.toBeNull();
  });

  it("ignore les valeurs non-string", async () => {
    fakeStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify([42, null, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]),
    );
    const res = await syncLocalFavoritesToServer();
    expect(res.total).toBe(1);
    expect(res.posted).toBe(1);
  });

  it("retourne un récap vide si localStorage est du JSON invalide", async () => {
    fakeStorage.setItem(FAVORITES_KEY, "not-json");
    const res = await syncLocalFavoritesToServer();
    expect(res).toEqual({
      total: 0,
      posted: 0,
      skipped: 0,
      failed: 0,
      cleared: false,
    });
  });
});

describe("SSR-safe (window indéfini)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
  });

  it("retourne un récap vide sans throw", async () => {
    const res = await syncLocalFavoritesToServer();
    expect(res.total).toBe(0);
  });
});
