"use client";

import { useTranslations } from "next-intl";
import { getEmptyState } from "@/lib/empty-state";

/**
 * Overlay affiché au centre de la carte quand 0 spots sont retournés.
 * Message contextuel selon : zoom + filtres actifs. Cf. issue #125.
 *
 * Délégation de la logique à `lib/empty-state.ts` (testable en isolation).
 * Composant purement présentationnel : pas de fetch, pas de state, pas de
 * side-effect — juste un render conditionnel.
 */
type Props = {
  count: number;
  zoom: number;
  selectedFamilies?: Set<string>;
  totalFamilies?: number;
  selectedCriteria?: Set<string>;
  /** PMTiles actives → jamais d'overlay « 0 spots » (#407). */
  hasTiles?: boolean;
};

export function EmptyStateOverlay({
  count,
  zoom,
  selectedFamilies,
  totalFamilies,
  selectedCriteria,
  hasTiles,
}: Props) {
  const t = useTranslations("map.emptyState");

  const result = getEmptyState({
    count,
    zoom,
    selectedFamilies,
    totalFamilies,
    selectedCriteria,
    hasTiles,
  });

  if (!result) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6"
    >
      <div className="pointer-events-auto max-w-sm rounded-lg border bg-background/95 px-5 py-4 text-center shadow-lg backdrop-blur">
        <p className="text-sm font-semibold text-foreground">{t(result.titleKey)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(result.descriptionKey)}
        </p>
      </div>
    </div>
  );
}
