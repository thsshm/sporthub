/**
 * `fetch` à timeout pour les clients Supabase serveur (résilience prod).
 *
 * Problème vécu (2026-06-11/12) : quand PostgREST/Supabase ne répond plus
 * (503 prolongé, projet en pause), les fetchs serveur PENDAIENT jusqu'au kill
 * 25 s de Vercel → la carte (`/api/venues`) renvoyait un **504 blanc** et les
 * pages sport/ville restaient bloquées 25-30 s pour de vrais utilisateurs.
 *
 * Avec ce wrapper, le fetch ABANDONNE après `timeoutMs` : le `try/catch` de
 * chaque data-fetch retombe alors sur son fallback (liste vide / état dégradé)
 * et la page RÉPOND sous la limite de la fonction, au lieu de pendre.
 *
 * Choix du délai (12 s) : volontairement AU-DESSUS du `statement_timeout`
 * serveur (les requêtes légitimement lentes échouent côté Postgres AVANT, avec
 * une vraie réponse d'erreur) et SOUS la limite 25 s de la fonction Vercel. On
 * ne coupe donc que les vrais hangs réseau (backend injoignable), jamais une
 * requête lente mais qui aboutit.
 */

export const SUPABASE_FETCH_TIMEOUT_MS = 12_000;

/**
 * Renvoie un `fetch` qui abandonne après `timeoutMs`. `baseFetch` est injectable
 * pour les tests. Respecte un `signal` déjà fourni par l'appelant (ex. la
 * méthode `.abortSignal()` de supabase-js) : abandon si l'un OU l'autre se
 * déclenche.
 */
export function createTimeoutFetch(
  timeoutMs: number = SUPABASE_FETCH_TIMEOUT_MS,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = init?.signal;
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener("abort", () => controller.abort(), { once: true });
    }

    return baseFetch(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
}
