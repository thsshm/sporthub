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

// Côté serveur uniquement — ne pas importer dans des Client Components
export const serverEnv = {
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
} as const;

// Côté client + serveur (prefixe NEXT_PUBLIC_)
export const publicEnv = {
  supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  maptilerKey: optionalEnv("NEXT_PUBLIC_MAPTILER_KEY"),
  posthogKey: optionalEnv("NEXT_PUBLIC_POSTHOG_KEY"),
  posthogHost: optionalEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.posthog.com"),
  sentryDsn: optionalEnv("NEXT_PUBLIC_SENTRY_DSN"),
} as const;
