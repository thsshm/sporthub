/**
 * Validation des variables d'environnement au démarrage.
 * Lève une erreur explicite si une variable requise est manquante,
 * plutôt que de planter silencieusement au runtime.
 *
 * On n'utilise pas zod pour éviter une dépendance supplémentaire dans le scaffold.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${key}\n` +
        `Copier .env.example vers .env.local et remplir la valeur.`
    );
  }
  return value;
}

function optionalEnv(key: string, defaultValue = ""): string {
  return process.env[key] ?? defaultValue;
}

// Côté serveur uniquement — ne pas importer dans des Client Components.
//
// Getter LAZY (#322) : la validation ne se déclenche qu'à l'ACCÈS, pas à
// l'import du module. Sinon, un Client Component qui importe `publicEnv` depuis
// ce module (ex. MapClient via `tilesUrl`, #226) chargeait aussi `serverEnv` →
// `requireEnv("SUPABASE_SERVICE_ROLE_KEY")` throw dans le navigateur (la clé
// serveur n'y existe pas) → crash client-side de /map.
export const serverEnv = {
  get supabaseServiceRoleKey(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
} as const;

// Côté client + serveur (prefixe NEXT_PUBLIC_)
export const publicEnv = {
  supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  maptilerKey: optionalEnv("NEXT_PUBLIC_MAPTILER_KEY"),
  // Vector tiles (#226). URL publique du .pmtiles (Supabase Storage/CDN).
  // Vide → rendu carte classique (/api/venues). Renseigné → rendu pmtiles://.
  tilesUrl: optionalEnv("NEXT_PUBLIC_TILES_URL"),
  posthogKey: optionalEnv("NEXT_PUBLIC_POSTHOG_KEY"),
  posthogHost: optionalEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.posthog.com"),
  sentryDsn: optionalEnv("NEXT_PUBLIC_SENTRY_DSN"),
} as const;
