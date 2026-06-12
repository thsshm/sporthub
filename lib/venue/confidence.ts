/**
 * Confiance d'une fiche venue (#613) — agrège les signaux qualité déjà calculés
 * pour décider s'il faut afficher un appel à contribution PLUS appuyé (« cette
 * fiche est douteuse/incomplète — vous connaissez ce lieu ? »).
 *
 * Réutilise, sans dupliquer la logique :
 * - `venueQualityScore` (#464) → fiche pauvre (peu d'adresse/contact/contenu) ;
 * - `getSportSignal` (#638)    → nom ↔ sport douteux (suspect/contradiction) ;
 * - `getCourtCountDisplay` (#636) → nombre de terrains invraisemblable.
 *
 * Pur, déterministe, testable. Ne touche pas la donnée — purement présentation.
 */
import { venueQualityScore, type ScorableVenue } from "@/lib/venue/quality-score";
import { getSportSignal } from "@/lib/venue/sport-rules";
import { getCourtCountDisplay } from "@/lib/venue/courts-plausibility";

/**
 * En-dessous de ce score, la fiche manque d'infos vérifiables (adresse, contact,
 * contenu) → on invite plus fortement à compléter. Plus haut que le seuil noindex
 * (25, #464) : on nudge aussi des fiches « moyennes » à enrichir, pas seulement
 * les squelettes.
 */
export const LOW_CONFIDENCE_SCORE = 40;

export type ConfidenceIssue = "incomplete" | "name_sport_mismatch" | "implausible_courts";

export type ConfidenceVenue = ScorableVenue & {
  family_slug?: string | null;
  courts_count?: number | null;
};

/**
 * Liste (déterministe) des raisons pour lesquelles une fiche est « peu fiable ».
 * Vide = fiche de confiance. `sportSlug` défaut = sport primaire de la venue.
 */
export function venueConfidenceIssues(
  venue: ConfidenceVenue,
  sportSlug?: string | null,
): ConfidenceIssue[] {
  const sport = sportSlug ?? venue.primary_sport_slug ?? null;
  const issues: ConfidenceIssue[] = [];

  if (venueQualityScore(venue) < LOW_CONFIDENCE_SCORE) issues.push("incomplete");

  if (sport) {
    const signal = getSportSignal(venue.name, sport);
    if (signal === "suspicious" || signal === "contradiction") {
      issues.push("name_sport_mismatch");
    }
  }

  // Un nombre de terrains renseigné mais non plausible (≠ « exact ») = donnée
  // douteuse → on invite à corriger.
  if (venue.courts_count != null && venue.courts_count > 0) {
    const display = getCourtCountDisplay(venue.courts_count, {
      sportSlug: sport,
      familySlug: venue.family_slug,
    });
    if (display.kind !== "exact") issues.push("implausible_courts");
  }

  return issues;
}

/** true si la fiche mérite un appel à contribution renforcé (#613). */
export function isLowConfidenceVenue(venue: ConfidenceVenue, sportSlug?: string | null): boolean {
  return venueConfidenceIssues(venue, sportSlug).length > 0;
}
