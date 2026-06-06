import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Contrôle de l'utilisateur renvoyé par auth.getUser(). vi.hoisted garantit que
// le holder existe avant le hoisting de vi.mock (pas de TDZ).
const auth = vi.hoisted(() => ({ user: null as { email?: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
  }),
}));

import { requireAdmin } from "@/lib/admin";

const ADMIN = "admin@sporthub.test";

describe("requireAdmin (gate sécurité /api/admin/*)", () => {
  const ORIGINAL = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    auth.user = null;
    process.env.ADMIN_EMAIL = ADMIN;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = ORIGINAL;
  });

  it("rejette si non authentifié", async () => {
    auth.user = null;
    await expect(requireAdmin()).rejects.toThrow(/not authenticated/);
  });

  it("rejette un utilisateur dont l'email ne correspond pas", async () => {
    auth.user = { email: "intrus@evil.test" };
    await expect(requireAdmin()).rejects.toThrow(/not admin/);
  });

  it("fail-closed : rejette si ADMIN_EMAIL n'est pas défini, même avec un user", async () => {
    delete process.env.ADMIN_EMAIL;
    auth.user = { email: ADMIN };
    await expect(requireAdmin()).rejects.toThrow(/not admin/);
  });

  it("fail-closed : rejette si ADMIN_EMAIL est vide", async () => {
    process.env.ADMIN_EMAIL = "";
    auth.user = { email: "" };
    // Un email vide ne doit jamais ouvrir l'accès, même si user.email == ADMIN_EMAIL == "".
    await expect(requireAdmin()).rejects.toThrow(/not admin/);
  });

  it("autorise l'admin dont l'email correspond exactement", async () => {
    auth.user = { email: ADMIN };
    const u = await requireAdmin();
    expect(u).toEqual({ email: ADMIN });
  });

  it("est sensible à la casse (pas de match approximatif sur l'email admin)", async () => {
    auth.user = { email: ADMIN.toUpperCase() };
    await expect(requireAdmin()).rejects.toThrow(/not admin/);
  });
});
