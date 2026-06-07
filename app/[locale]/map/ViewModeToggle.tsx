"use client";

import { Map as MapIcon, List, Columns } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ViewMode } from "@/lib/map-storage";

/**
 * Toggle 3 boutons : carte / liste / side-by-side. Cf. issue #123.
 *
 * Le mode `split` est affiché mais désactivé visuellement sur viewport
 * < 1100px (géré côté parent via `disableSplit`). En mobile, le toggle reste
 * réduit à carte/liste uniquement.
 */
type Props = {
  active: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Désactive le bouton "split" (typiquement viewport < 1100px). */
  disableSplit?: boolean;
  /** Masque complètement "split" (mobile : seulement carte ↔ liste). */
  hideSplit?: boolean;
  className?: string;
};

export function ViewModeToggle({
  active,
  onChange,
  disableSplit,
  hideSplit,
  className,
}: Props) {
  const t = useTranslations("map.viewMode");

  const btn = (mode: ViewMode, Icon: typeof MapIcon, labelKey: string, disabled = false) => {
    const isActive = active === mode;
    return (
      <button
        key={mode}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        disabled={disabled}
        onClick={() => !disabled && onChange(mode)}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
          isActive
            ? "bg-foreground text-background"
            : disabled
              ? "cursor-not-allowed text-muted-foreground/40"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t(labelKey)}</span>
      </button>
    );
  };

  return (
    <div
      role="tablist"
      aria-label={t("toggleLabel")}
      className={`inline-flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-sm backdrop-blur ${className ?? ""}`}
    >
      {btn("map", MapIcon, "map")}
      {btn("list", List, "list")}
      {!hideSplit && btn("split", Columns, "split", disableSplit)}
    </div>
  );
}
