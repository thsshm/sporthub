"use client";

import { useTranslations } from "next-intl";
import { FAMILIES } from "@/lib/families";

/**
 * Bandeau horizontal de chips pour switcher rapidement entre familles
 * (single-active mode). Complète SportFilters (checkboxes multi-select)
 * en offrant le pattern V1 "1 famille à la fois en 1 clic".
 *
 * Sémantique :
 *   - `activeSlug = null`  → "Toutes les familles" actives (état par défaut)
 *   - `activeSlug = "raquette"` → uniquement cette famille filtrée
 *   - Clic sur la chip active → revient à "Toutes" (toggle off)
 *   - Clic sur une autre chip → bascule à cette famille (single-select)
 *
 * Cf. issue #121.
 */
type Props = {
  /** Slug de la famille active, ou null pour "Toutes". */
  activeSlug: string | null;
  /** Callback de changement. null = retour à "Toutes". */
  onSelect: (slug: string | null) => void;
  className?: string;
};

export function FamilySwitcher({ activeSlug, onSelect, className }: Props) {
  const tFamilies = useTranslations("families");
  const tMap = useTranslations("map");

  return (
    <div
      role="tablist"
      aria-label={tMap("filtersTitle")}
      className={`flex gap-1.5 overflow-x-auto pb-1 ${className ?? ""}`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeSlug === null}
        onClick={() => onSelect(null)}
        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
          activeSlug === null
            ? "border-foreground bg-foreground text-background"
            : "border-input bg-background text-foreground hover:bg-accent"
        }`}
      >
        {tMap("filtersAll")}
      </button>
      {FAMILIES.map((f) => {
        const active = activeSlug === f.slug;
        const name = tFamilies(f.slug);
        return (
          <button
            key={f.slug}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={name}
            onClick={() => onSelect(active ? null : f.slug)}
            className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-90"
            style={
              active
                ? {
                    backgroundColor: f.color,
                    color: "white",
                    borderColor: f.color,
                  }
                : {
                    borderColor: `${f.color}66`, // 40% alpha
                    color: f.color,
                  }
            }
          >
            <span aria-hidden="true" className="mr-1">
              {f.emoji}
            </span>
            {name}
          </button>
        );
      })}
    </div>
  );
}
