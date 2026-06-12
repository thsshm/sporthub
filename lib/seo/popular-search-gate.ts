/**
 * Gate qualité des « Recherches populaires » de la home (#699, durcit #644).
 *
 * Une recherche populaire ne doit promouvoir qu'une page sport×ville réellement
 * digne de confiance pour un primo-visiteur. L'ancien gate ne comptait que les
 * venues `quality_score ≥ seuil` (getVisibleVenueCount) — ce qui SUR-COMPTE :
 *   - des enregistrements court-level (« Sportfield 16 piste 1 ») comptés comme
 *     des venues séparées (vu sur /padel/fr/paris) ;
 *   - des venues dont le nom contredit le sport (misclassif #553).
 *
 * Ce gate réplique le pipeline d'AFFICHAGE de la page ville (CityPageView) :
 *   1. `groupCourtRecords` (#635/#696) fusionne les court-level ;
 *   2. on exclut les noms contredisant le sport (`isSportMismatch`, #553).
 * Le nombre restant = cards « haute confiance » réellement affichées. Une page
 * est éligible si ce nombre atteint le seuil. Les venues passées sont supposées
 * déjà filtrées qualité (`quality_score ≥ seuil`) par la requête amont. Pur,
 * testable, sans I/O.
 */
import { groupCourtRecords, type GroupableVenue } from "@/lib/venue/group-courts";
import { isSportMismatch } from "@/lib/venue/sport-mismatch";

/** Minimum de cards haute confiance pour qu'une recherche populaire soit promue. */
export const MIN_HIGH_CONFIDENCE_CARDS = 5;

/**
 * Compte les cards haute confiance réellement affichables pour `sportSlug`,
 * en répliquant le pipeline de la liste ville (group court records → exclusion
 * des noms contradictoires). `rows` doit déjà être filtré qualité en amont.
 */
export function highConfidenceCardCount<T extends GroupableVenue>(
  rows: T[],
  sportSlug: string,
): number {
  return groupCourtRecords(rows).filter((v) => !isSportMismatch(v.name, sportSlug)).length;
}

/**
 * Une page sport×ville est-elle éligible aux recherches populaires ? = au moins
 * `min` cards haute confiance après group + exclusion mismatch.
 */
export function isPopularSearchEligible<T extends GroupableVenue>(
  rows: T[],
  sportSlug: string,
  min: number = MIN_HIGH_CONFIDENCE_CARDS,
): boolean {
  return highConfidenceCardCount(rows, sportSlug) >= min;
}
