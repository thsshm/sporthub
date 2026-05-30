/**
 * Client Supabase pour les Server Components et Route Handlers.
 * Lit les cookies via next/headers pour maintenir la session utilisateur.
 * Utilise la clé anon par défaut — passer serviceRoleKey pour les opérations admin.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Réconcilie le type de client renvoyé par @supabase/ssr avec celui de
 * @supabase/supabase-js. ssr@0.5.2 deep-importe `GenericSchema` depuis un
 * chemin interne supprimé dans supabase-js ≥ 2.106 → le générique
 * `SupabaseClient<Database>` de ssr ne s'aligne plus sur le nôtre, ce qui
 * casse `.insert()` (attend `never`) et `.rpc()` (args `undefined`).
 * On re-type explicitement via le `SupabaseClient<Database>` de supabase-js.
 * À retirer dès qu'on bump @supabase/ssr ≥ 0.6.
 */
const asTypedClient = (c: unknown) => c as SupabaseClient<Database>;

/**
 * Client standard (clé anon + RLS actif) — pour la plupart des Server Components.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  const cookieStore = cookies();

  return asTypedClient(createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
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
  ));
}

/**
 * Client admin (service_role key, bypass RLS).
 * Réservé aux Route Handlers admin + scripts serveur.
 * Ne jamais exposer côté client.
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  const cookieStore = cookies();

  return asTypedClient(createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
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
  ));
}
