import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Vérifie que l'user courant est admin (email === ADMIN_EMAIL).
 * À appeler au début de chaque server action ou route handler /api/admin/*.
 * Throw si pas admin (provoque une 500 client + log).
 */
export async function requireAdmin() {
  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    throw new Error("Forbidden: not authenticated");
  }
  if (!process.env.ADMIN_EMAIL || user.email !== process.env.ADMIN_EMAIL) {
    throw new Error("Forbidden: not admin");
  }
  return user;
}
