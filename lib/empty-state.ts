/**
 * Helper qui détermine quel message contextuel afficher quand la map ne
 * retourne aucun spot. Pattern V1 — l'utilisateur a besoin d'un guide
 * actionnable, pas d'un générique "0 spots dans la vue".
 *
 * Cf. issue #125. Scope V1 :
 *   - empty_zoom_too_high : zoom > 14 et 0 venues → "Zoomez moins"
 *   - empty_zoom_too_low : zoom < 4 → "Zoomez plus sur une zone"
 *   - empty_filters : filtres famille/sport actifs avec 0 résultats → "Aucun
 *     spot pour ce filtre dans cette zone"
 *   - empty_generic : tous les cas restants → "Aucun spot dans cette zone"
 *
 * Out-of-scope (à itérer plus tard avec un endpoint /api/venues/nearest) :
 *   - empty_sport_in_city avec suggestion "essayer Mende (90 km)"
 *   - loading skeleton (déjà géré par MapClient via state interne)
 *   - error toast (à venir avec wire Sentry #95)
 */

export type EmptyStateKind =
  | "empty_zoom_too_high"
  | "empty_zoom_too_low"
  | "empty_filters"
  | "empty_generic";

export type EmptyStateInput = {
  /** Nombre de spots retournés par le dernier fetch /api/venues. */
  count: number;
  /** Zoom MapLibre courant. */
  zoom: number;
  /** Filtres famille actifs (single-select ou multi-select via SportFilters). */
  selectedFamilies?: Set<string>;
  /** Nombre total de familles existantes (pour détecter "tout coché = pas de filtre"). */
  totalFamilies?: number;
  /** Critères universels cochés (lit / indoor / wheelchair / free / paid). */
  selectedCriteria?: Set<string>;
  /**
   * Les tuiles vectorielles PMTiles sont actives (#226/#407).
   * Quand true, ne jamais afficher l'overlay « 0 spots » : le rendu visuel
   * vient des tuiles (toujours peuplées) et count=0 est un artefact du
   * découplage tuiles/API — pas une zone vraiment vide.
   */
  hasTiles?: boolean;
};

export type EmptyStateResult = {
  kind: EmptyStateKind;
  /** Clé i18n du titre (à passer à `useTranslations("map.emptyState")(key)`). */
  titleKey: string;
  /** Clé i18n du sous-titre / description. */
  descriptionKey: string;
};

/**
 * Détermine si on doit afficher un empty state, et lequel.
 * Retourne null si count > 0 (= ne pas afficher d'empty state).
 */
export function getEmptyState(input: EmptyStateInput): EmptyStateResult | null {
  if (input.count > 0) return null;

  // En mode PMTiles, les spots sont rendus par les tuiles (toujours peuplées).
  // count=0 est un artefact du découplage tuiles/API — pas une zone vide réelle.
  // On supprime l'overlay pour ne jamais afficher « 0 spots » par-dessus des
  // pastilles visibles (cf. #407).
  if (input.hasTiles) return null;

  // Cas 1 — zoom trop bas (vue planétaire) : on ne charge probablement rien
  // côté serveur (cf. global bypass #143 retourne quand même 200 max).
  if (input.zoom < 4) {
    return {
      kind: "empty_zoom_too_low",
      titleKey: "zoomTooLowTitle",
      descriptionKey: "zoomTooLowDescription",
    };
  }

  // Cas 2 — zoom trop haut (genre 16+ sur l'océan ou zone sans data).
  if (input.zoom > 14) {
    return {
      kind: "empty_zoom_too_high",
      titleKey: "zoomTooHighTitle",
      descriptionKey: "zoomTooHighDescription",
    };
  }

  // Cas 3 — filtres actifs (familles partielles OU critères cochés).
  const hasFamilyFilter =
    input.selectedFamilies !== undefined &&
    input.totalFamilies !== undefined &&
    input.selectedFamilies.size > 0 &&
    input.selectedFamilies.size < input.totalFamilies;
  const hasCriteriaFilter =
    input.selectedCriteria !== undefined && input.selectedCriteria.size > 0;
  if (hasFamilyFilter || hasCriteriaFilter) {
    return {
      kind: "empty_filters",
      titleKey: "filtersEmptyTitle",
      descriptionKey: "filtersEmptyDescription",
    };
  }

  // Cas 4 — fallback générique (zone vide sans filtre).
  return {
    kind: "empty_generic",
    titleKey: "genericTitle",
    descriptionKey: "genericDescription",
  };
}
