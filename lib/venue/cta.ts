/**
 * Helpers pour les CTA d'action des fiches venue (#467).
 */

/**
 * Construit un lien `tel:` propre pour le CTA « Appeler ».
 *
 * Les numéros importés contiennent espaces, points, tirets ou parenthèses
 * (`+33 1 02 03 04 05`, `01.02.03.04.05`) ; un `tel:` fiable ne garde que le
 * `+` initial et les chiffres. Retourne `null` si le numéro ne contient aucun
 * chiffre (donnée corrompue) → le CTA n'est alors pas rendu.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  // Un `+` seul, ou une chaîne sans chiffre, n'est pas un numéro valide.
  if (!/\d/.test(cleaned)) return null;
  return `tel:${cleaned}`;
}
