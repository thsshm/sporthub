/**
 * Client Supabase pour les Client Components ("use client").
 * Utilise @supabase/ssr pour gérer les cookies côté navigateur.
 * Ne jamais importer serverEnv ici — ce fichier est chargé côté client.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

// Singleton — évite de recréer un client à chaque render
let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function getSupabaseBrowserClient() {
  if (client) return client;

  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  return client;
}
