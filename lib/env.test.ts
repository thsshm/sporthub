import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Régression #322 : la page /map crashait côté navigateur car MapClient importe
 * `publicEnv` depuis `lib/env`, et le module évaluait `serverEnv = {
 * supabaseServiceRoleKey: requireEnv(...) }` au niveau module → throw dans le
 * navigateur (la clé serveur n'y existe pas). Le fix rend `serverEnv` lazy.
 */
describe("lib/env — serverEnv lazy (#322)", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Scénario navigateur : les NEXT_PUBLIC_* sont inlinés/présents…
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    // …mais la clé SERVEUR est absente (jamais exposée au client).
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("importer le module + lire publicEnv ne crashe PAS sans la clé serveur", async () => {
    const mod = await import("./env");
    // C'est le cas réel : un Client Component lit publicEnv → aucun throw.
    expect(mod.publicEnv.supabaseUrl).toBe("https://x.supabase.co");
    expect(mod.publicEnv.tilesUrl).toBe("");
  });

  it("la clé serveur n'est validée qu'à l'accès (et throw si absente)", async () => {
    const mod = await import("./env");
    expect(() => mod.serverEnv.supabaseServiceRoleKey).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("la clé serveur est lisible quand elle est présente", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const mod = await import("./env");
    expect(mod.serverEnv.supabaseServiceRoleKey).toBe("service-key");
  });
});
