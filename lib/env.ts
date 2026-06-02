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

// Côté serveur uniquement.
//
// IMPORTANT : getter LAZY (et non `requireEnv(...)` au niveau module). Sinon,
// dès qu'un Client Component importe `publicEnv` depuis ce fichier, le module
// `lib/env` est évalué dans le bundle navigateur et `requireEnv` throw
// (SUPABASE_SERVICE_ROLE_KEY n'existe pas côté client) → crash client-side de
// la page (cf. #322, /map cassé après l'import de publicEnv dans MapClient).
// Avec un getter, la validation ne s'exécute qu'au moment où du code SERVEUR
// lit réellement `serverEnv.supabaseServiceRoleKey`.
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
