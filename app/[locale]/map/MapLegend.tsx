"use client";

import { useTranslations } from "next-intl";
import { FAMILIES_BY_SLUG } from "@/lib/families";

type Props = {
  /** Slugs des familles actives à afficher dans la légende. */
  activeSlugs: string[];
  className?: string;
};

/**
 * Légende compacte des couleurs par famille, affichée en overlay carte quand
 * 2+ familles sont actives (mode explore multi-disciplines). Une ligne
 * scrollable horizontalement : pastille couleur + emoji + nom. Cf. #132.
 */
export function MapLegend({ activeSlugs, className }: Props) {
  const tFamilies = useTranslations("families");
  const tMap = useTranslations("map");

  return (
    <div
      role="group"
      aria-label={tMap("legend")}
      className={`pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2.5 overflow-x-auto rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-md backdrop-blur ${className ?? ""}`}
    >
      {activeSlugs.map((slug) => {
        const f = FAMILIES_BY_SLUG[slug];
        if (!f) return null;
        return (
          <span key={slug} className="flex shrink-0 items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: f.color }}
              aria-hidden="true"
            />
            <span aria-hidden="true">{f.emoji}</span>
            <span className="whitespace-nowrap">{tFamilies(slug)}</span>
          </span>
        );
      })}
    </div>
  );
}
