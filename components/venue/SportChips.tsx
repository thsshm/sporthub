/**
 * Chips colorées pour les sports d'un venue.
 * Couleur par famille, emoji par sport.
 */
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";

type Props = {
  sportSlugs: string[];
  className?: string;
};

export function SportChips({ sportSlugs, className }: Props) {
  if (!sportSlugs.length) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {sportSlugs.map((slug) => {
        const sport = SPORTS_BY_SLUG[slug];
        if (!sport) return null;

        const family = FAMILIES_BY_SLUG[sport.family_slug];
        const color = family?.color ?? "#6b7280";

        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: color }}
            title={sport.name_fr}
          >
            {sport.emoji && <span aria-hidden="true">{sport.emoji}</span>}
            {sport.name_fr}
          </span>
        );
      })}
    </div>
  );
}
