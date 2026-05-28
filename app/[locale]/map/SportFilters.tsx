"use client";

import { useTranslations } from "next-intl";
import { FAMILIES } from "@/lib/families";

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
};

export function SportFilters({ selected, onChange, className }: Props) {
  const tMap = useTranslations("map");
  const tFamilies = useTranslations("families");

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(FAMILIES.map((f) => f.slug)));
  const selectNone = () => onChange(new Set());

  return (
    <aside
      aria-label={tMap("filtersTitle")}
      className={`flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur ${className ?? ""}`}
    >
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
    </aside>
  );
}
