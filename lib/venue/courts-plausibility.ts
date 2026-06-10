/**
 * Plausibilité du nombre de courts à l'AFFICHAGE (#555). Certaines venues ont un
 * `courts_count` aberrant (agrégation au niveau équipement/facility mal
 * contrôlée — ex. un complexe qui remonte 200 « courts »). Plutôt que d'afficher
 * une valeur fausse, on la masque au-dessus d'un seuil par famille.
 *
 * NB : ne corrige PAS la donnée (ça relève du dédup #554 / d'un champ de
 * confiance). C'est un garde-fou d'affichage, conservateur : seuils larges pour
 * ne masquer que l'invraisemblable, jamais un vrai gros club.
 */

// Plafond crédible de courts/terrains pour UNE venue, par famille. Au-delà =
// quasi sûrement une agrégation au mauvais niveau → on n'affiche pas.
const FAMILY_MAX_COURTS: Record<string, number> = {
  raquette: 40, // un très gros centre tennis ≈ 25-30 courts
  ballon: 30,
  boules: 60, // les boulodromes peuvent aligner beaucoup de pistes
  baignade: 25,
  combat: 20,
  fitness: 30,
  yoga: 30,
  nautique: 30,
  glisse: 20,
  snow: 20,
  hike: 20,
  retraites: 20,
  plus: 40,
};
const DEFAULT_MAX = 50;

/**
 * Renvoie le nombre de courts s'il est plausible pour la famille, sinon `null`
 * (= ne pas afficher). Pur, testable.
 */
export function plausibleCourtCount(
  count: number | null | undefined,
  familySlug: string | null | undefined,
): number | null {
  if (count == null || count <= 0) return null;
  const max = (familySlug && FAMILY_MAX_COURTS[familySlug]) || DEFAULT_MAX;
  return count <= max ? count : null;
}
