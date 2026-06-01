/**
 * Client Supabase pour les Server Components et Route Handlers.
 * Lit les cookies via next/headers pour maintenir la session utilisateur.
 * Utilise la clé anon par défaut — passer serviceRoleKey pour les opérations admin.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
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
 * Client stateless pour les pages ISR/statiques (home, sports, programmatiques).
 *
 * N'appelle PAS `cookies()` — évite d'opter la route dans le mode dynamic de
 * Next.js, ce qui forçait Vercel à servir `cache-control: private, no-store`
 * même avec `export const revalidate = 300` (cf. issue #191).
 *
 * Utilise la service_role key (bypass RLS). À utiliser UNIQUEMENT pour des
 * reads publics (is_published=true, deleted_at IS NULL), jamais pour des
 * données utilisateur. Les handlers cookies sont des no-ops intentionnels.
 */
export function getSupabaseStaticClient(): SupabaseClient<Database> {
  // Fallback placeholder au build sans .env.local (worktrees locaux, CI sans
  // secrets). createServerClient rejette les chaînes vides → placeholder non-
  // vide. Les appels réseau échoueront mais les try/catch dans chaque fetch
  // retournent des données vides, donc le build passe avec du contenu vide.
  // Sur Vercel, les vraies env vars sont toujours présentes — ce cas n'arrive pas.
  return asTypedClient(createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "build-placeholder",
    {
      cookies: {
        getAll() { return []; },  // stateless — pas de session utilisateur
        setAll() {},              // no-op
      },
    }
  ));
}

/**
 * Client Edge — utilise `createClient` de @supabase/supabase-js directement
 * (pas de @supabase/ssr) pour rester compatible avec le Edge runtime Vercel.
 *
 * @supabase/ssr importe `next/headers` au niveau module, ce qui interdit le
 * Edge runtime dès qu'on importe getSupabaseAdminClient/getSupabaseServerClient
 * (même si cookies() n'est pas appelé). createClient n'a pas cette dépendance
 * et tourne nativement sur fetch (compatible Vercel Edge, Deno, Cloudflare Workers).
 *
 * Utilise la service_role key (bypass RLS). Réservé aux Route Handlers publics
 * en lecture seule (is_published=true, deleted_at IS NULL appliqués en SQL).
 * Ne jamais exposer côté client. Cf. #113.
 */
export function getSupabaseEdgeClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "build-placeholder",
  );
}

/**
 * Client Edge anon — `createClient` de @supabase/supabase-js (pas de @supabase/ssr,
 * cf. getSupabaseEdgeClient ci-dessus) mais avec la clé PUBLIQUE `anon` au lieu
 * de la `service_role`.
 *
 * Destiné aux Route Handlers Edge PUBLICS en lecture seule (/api/venues,
 * /api/venues/clubs) qui appellent des RPC `SECURITY DEFINER` (migration 0015).
 * Ces RPC filtrent en interne `is_published = true AND deleted_at IS NULL`, donc
 * aucune donnée privée ne fuit, ET le coût d'évaluation RLS par ligne (cause du
 * statement_timeout sur les régions peu denses) disparaît côté définisseur.
 *
 * On retire ainsi la `service_role` (god-mode) du chemin public — cf. #225.
 * La clé anon est de toute façon publique (préfixe NEXT_PUBLIC_), donc aucun
 * secret supplémentaire n'est exposé. RLS reste active sur les SELECT directs
 * éventuels via ce client (on n'en fait pas : on passe uniquement par RPC).
 */
export function getSupabaseAnonEdgeClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "build-placeholder",
  );
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
