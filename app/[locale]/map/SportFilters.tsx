"use client";

import { useTranslations } from "next-intl";
import { FAMILIES } from "@/lib/families";

/** Critères universels — héritage filtres V1 (sporthub-map.js, UNIVERSAL_FILTERS).
 * Mappent côté DB :
 *   lit        → v.has_lighting = TRUE
 *   indoor     → v.is_indoor = TRUE
 *   wheelchair → v.is_wheelchair_accessible = TRUE
 *   free       → v.fee_required = FALSE
 *   paid       → v.fee_required = TRUE
 */
export const CRITERIA = [
  { key: "lit", emoji: "🌙" },
  { key: "indoor", emoji: "🏠" },
  { key: "wheelchair", emoji: "♿" },
  { key: "free", emoji: "🆓" },
  { key: "paid", emoji: "💰" },
] as const;

export type CriteriaKey = (typeof CRITERIA)[number]["key"];

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  selectedCriteria: Set<CriteriaKey>;
  onCriteriaChange: (next: Set<CriteriaKey>) => void;
  className?: string;
};

export function SportFilters({
  selected,
  onChange,
  selectedCriteria,
  onCriteriaChange,
  className,
}: Props) {
  const tMap = useTranslations("map");
  const tFamilies = useTranslations("families");
  const tFeat = useTranslations("map.feat");

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(FAMILIES.map((f) => f.slug)));
  const selectNone = () => onChange(new Set());

  const toggleCriterion = (key: CriteriaKey) => {
    const next = new Set(selectedCriteria);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onCriteriaChange(next);
  };

  return (
    <aside
      aria-label={tMap("filtersTitle")}
      className={`flex flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur ${className ?? ""}`}
    >
      {/* Familles */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{tMap("filtersTitle")}</h2>
          <div className="flex gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              className="text-blue-600 hover:underline"
            >
              {tMap("filtersAll")}
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-blue-600 hover:underline"
            >
              {tMap("filtersNone")}
            </button>
          </div>
        </div>
        <ul className="space-y-0.5">
          {FAMILIES.map((f) => {
            const name = tFamilies(f.slug);
            return (
              <li key={f.slug}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selected.has(f.slug)}
                    onChange={() => toggle(f.slug)}
                    className="h-3.5 w-3.5 cursor-pointer"
                    aria-label={name}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: f.color }}
                    aria-hidden="true"
                  />
                  <span aria-hidden="true">{f.emoji}</span>
                  <span className="truncate">{name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Critères universels */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <h3 className="text-sm font-semibold">{tMap("criteriaTitle")}</h3>
        <ul className="space-y-0.5">
          {CRITERIA.map((c) => {
            const name = tFeat(c.key);
            return (
              <li key={c.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selectedCriteria.has(c.key)}
                    onChange={() => toggleCriterion(c.key)}
                    className="h-3.5 w-3.5 cursor-pointer"
                    aria-label={name}
                  />
                  <span aria-hidden="true">{c.emoji}</span>
                  <span className="truncate">{name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
