/**
 * Validation des variables d'environnement PUBLIQUES (NEXT_PUBLIC_*).
 * Lève une erreur explicite si une variable requise est manquante,
 * plutôt que de planter silencieusement au runtime.
 *
 * Ce module est volontairement « client-safe » : il ne référence QUE des
 * variables NEXT_PUBLIC_*, et n'importe aucun module serveur. Les secrets
 * serveur (ex. SUPABASE_SERVICE_ROLE_KEY) vivent dans `lib/env.server.ts`,
 * gardé par `import "server-only"`, pour qu'aucune référence à ces clés ne
 * finisse dans un bundle navigateur — un Client Component (MapClient via
 * `tilesUrl`, #226) importe `publicEnv` d'ici, donc tout ce qui est déclaré ici
 * est bundlé côté client (#325).
 *
 * On n'utilise pas zod pour éviter une dépendance supplémentaire dans le scaffold.
 */

// ⚠️ Accès STATIQUES obligatoires (#325). Next.js n'inline dans le bundle
// navigateur que les références littérales `process.env.NEXT_PUBLIC_X`. Un accès
// dynamique `process.env[key]` n'est PAS remplacé → vaut `undefined` côté client
// même si la variable est définie au build → throw au chargement du module →
// crash "Application error" sur /map et /sports/[sport] (MapClient importe
// `publicEnv` via `tilesUrl`). On passe donc ici la valeur, lue statiquement.
function requireEnv(key: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${key}\n` +
        `Copier .env.example vers .env.local et remplir la valeur.`
    );
  }
  return value;
}

// Côté client + serveur (prefixe NEXT_PUBLIC_)
export const publicEnv = {
  supabaseUrl: requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ),
  supabaseAnonKey: requireEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "",
  // Vector tiles (#226). URL publique du .pmtiles (Supabase Storage/CDN).
  // Vide → rendu carte classique (/api/venues). Renseigné → rendu pmtiles://.
  tilesUrl: process.env.NEXT_PUBLIC_TILES_URL ?? "",
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
  posthogHost:
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com",
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",
} as const;
