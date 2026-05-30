/**
 * Client Supabase pour les Client Components ("use client").
 * Utilise @supabase/ssr pour gérer les cookies côté navigateur.
 * Ne jamais importer serverEnv ici — ce fichier est chargé côté client.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Singleton — évite de recréer un client à chaque render
let client: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (client) return client;

  // Cast vers le SupabaseClient de supabase-js : cf. lib/supabase/server.ts
  // (skew de générique ssr@0.5.2 ↔ supabase-js ≥ 2.106). À retirer au bump ssr ≥ 0.6.
  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ) as unknown as SupabaseClient<Database>;

  return client;
}
