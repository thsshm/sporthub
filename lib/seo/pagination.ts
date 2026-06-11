/**
 * URL d'une page de liste paginée sport×ville.
 *
 * Page 1 = chemin canonique SANS suffixe (`/tennis/fr/lyon`) ; pages 2+ =
 * segment de route `/page/N` (`/tennis/fr/lyon/page/2`). **Pas de query-string** :
 * `?page=N` est une API dynamique Next.js qui force le rendu `no-store` et
 * empêche l'ISR (cf. #191). En passant par un segment de route, la page reste
 * statique/ISR (cachée), donc rapide pour le crawl SEO.
 *
 * `basePath` est sans préfixe de locale (`/tennis/fr/lyon`) — le `<Link>`
 * next-intl ajoute la locale.
 */
export function cityPageHref(basePath: string, page: number): string {
  const clean = basePath.replace(/\/+$/, "");
  return page <= 1 ? clean : `${clean}/page/${page}`;
}

/** Parse le segment `[n]` de pagination : entier ≥ 1, sinon null (→ 404). */
export function parsePageSegment(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
