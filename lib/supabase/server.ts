/**
 * Client Supabase pour les Server Components et Route Handlers.
 * Lit les cookies via next/headers pour maintenir la session utilisateur.
 * Utilise la clé anon par défaut — passer serviceRoleKey pour les opérations admin.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

/**
 * Client standard (clé anon + RLS actif) — pour la plupart des Server Components.
 */
export function getSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll peut échouer dans les Server Components en lecture seule —
            // c'est acceptable, on ignore l'erreur
          }
        },
      },
    }
  );
}

/**
 * Client admin (service_role key, bypass RLS).
 * Réservé aux Route Handlers admin + scripts serveur.
 * Ne jamais exposer côté client.
 */
export function getSupabaseAdminClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ignoré côté Server Components
          }
        },
      },
    }
  );
}
