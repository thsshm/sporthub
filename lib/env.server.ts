import "server-only";

/**
 * Variables d'environnement réservées au SERVEUR (secrets jamais exposables au
 * navigateur).
 *
 * `import "server-only"` fait ÉCHOUER LE BUILD si ce module est importé, même
 * indirectement, par un Client Component (`"use client"`). C'est le garde-fou
 * structurel de #325 : la chaîne `SUPABASE_SERVICE_ROLE_KEY` (clé admin qui
 * bypass tout RLS) ne peut donc plus se retrouver dans un chunk client.
 *
 * Pourquoi un fichier séparé de `lib/env.ts` : `MapClient.tsx` (Client
 * Component) importe `publicEnv` depuis `lib/env`, ce qui bundle l'intégralité
 * de ce module côté navigateur. Tant que `serverEnv` y cohabitait, la référence
 * à la clé service_role partait dans le bundle client. En l'isolant ici, seul
 * du code serveur (Route Handlers, Server Components, scripts) peut l'atteindre.
 *
 * Volontairement autonome : on duplique le petit garde `requireEnv` plutôt que
 * de l'importer depuis `lib/env.ts`, pour que ce module serveur n'entraîne pas
 * l'évaluation de `publicEnv` (NEXT_PUBLIC_*) au simple import.
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

/**
 * Getter LAZY : la validation ne se déclenche qu'à l'ACCÈS, pas à l'import —
 * un build serveur sans `.env.local` (worktrees, CI sans secrets) ne casse pas
 * tant que personne ne lit réellement la clé (cf. #322).
 */
export const serverEnv = {
  get supabaseServiceRoleKey(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
} as const;
