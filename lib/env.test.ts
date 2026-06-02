import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Garde-fou #322 : importer `lib/env` (pour `publicEnv`) ne doit JAMAIS
 * déclencher la validation de SUPABASE_SERVICE_ROLE_KEY — sinon tout Client
 * Component qui importe `publicEnv` crashe côté navigateur (cas /map).
 * serverEnv doit être lazy (getter évalué seulement à l'accès).
 */
describe("lib/env — serverEnv lazy (#322)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("importer le module ne throw pas même sans SUPABASE_SERVICE_ROLE_KEY", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    // L'import (et l'accès à publicEnv) ne doit pas lever.
    await expect(import("./env")).resolves.toBeDefined();
    const mod = await import("./env");
    expect(mod.publicEnv.supabaseUrl).toBe("https://x.supabase.co");
  });

  it("accéder à serverEnv.supabaseServiceRoleKey throw si la clé manque", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { serverEnv } = await import("./env");
    expect(() => serverEnv.supabaseServiceRoleKey).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("serverEnv.supabaseServiceRoleKey renvoie la valeur quand présente", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { serverEnv } = await import("./env");
    expect(serverEnv.supabaseServiceRoleKey).toBe("svc-secret");
  });
});
