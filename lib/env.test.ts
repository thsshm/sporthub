import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Garde-fou #322 : importer `lib/env` (pour `publicEnv`) ne doit JAMAIS
 * déclencher la validation de SUPABASE_SERVICE_ROLE_KEY — sinon tout Client
 * Component qui importe `publicEnv` crashe côté navigateur (cas /map).
 *
 * Garde-fou #325 : le module public ne référence AUCUN secret serveur. La clé
 * service_role vit dans `lib/env.server.ts` (séparé + `import "server-only"`),
 * pour ne jamais finir dans un bundle client. Les tests `serverEnv` ciblent
 * donc ce module-là.
 */
describe("lib/env — publicEnv client-safe (#322/#325)", () => {
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

  it("le module public ne référence pas serverEnv (cloisonnement #325)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const mod = await import("./env");
    expect("serverEnv" in mod).toBe(false);
  });

  // Garde-fou anti-régression du CRASH /map (#325). Le DefinePlugin de Next.js
  // n'inline dans le bundle client QUE les accès littéraux `process.env.NEXT_PUBLIC_X`.
  // Un accès dynamique `process.env[key]` n'est pas remplacé → undefined côté
  // navigateur → publicEnv throw au chargement → "Application error" sur /map.
  // Ce test échoue si quelqu'un réintroduit un accès dynamique dans ce module.
  it("lit process.env en accès STATIQUE uniquement (pas de process.env[key])", () => {
    const raw = readFileSync(fileURLToPath(new URL("./env.ts", import.meta.url)), "utf8");
    // On retire commentaires (bloc + ligne) avant le check : la doc mentionne
    // volontairement `process.env[key]` pour l'expliquer.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\.env\s*\[/);
  });
});

describe("lib/env.server — serverEnv lazy (#322/#325)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accéder à serverEnv.supabaseServiceRoleKey throw si la clé manque", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { serverEnv } = await import("./env.server");
    expect(() => serverEnv.supabaseServiceRoleKey).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("serverEnv.supabaseServiceRoleKey renvoie la valeur quand présente", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-secret");
    const { serverEnv } = await import("./env.server");
    expect(serverEnv.supabaseServiceRoleKey).toBe("svc-secret");
  });
});
