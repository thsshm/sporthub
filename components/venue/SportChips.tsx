/**
 * Chips colorées pour les sports d'un venue.
 * Couleur par famille, emoji par sport, nom traduit via next-intl.
 */
import { useTranslations } from "next-intl";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";

type Props = {
  sportSlugs: string[];
  className?: string;
};

export function SportChips({ sportSlugs, className }: Props) {
  const tSports = useTranslations("sports");
  if (!sportSlugs.length) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {sportSlugs.map((slug) => {
        const sport = SPORTS_BY_SLUG[slug];
        if (!sport) return null;

        const family = FAMILIES_BY_SLUG[sport.family_slug];
        const color = family?.color ?? "#6b7280";
        const name = tSports.has(sport.slug) ? tSports(sport.slug) : sport.name_fr;

        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: color }}
            title={name}
          >
            {sport.emoji && <span aria-hidden="true">{sport.emoji}</span>}
            {name}
          </span>
        );
      })}
    </div>
  );
}
