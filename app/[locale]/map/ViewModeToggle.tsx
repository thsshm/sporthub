"use client";

import { useTranslations } from "next-intl";
import { Map as MapIcon, List, Columns } from "lucide-react";
import type { ViewMode } from "@/lib/map-storage";

/**
 * Toggle 3 modes d'affichage de /map : carte / liste / side-by-side.
 *
 * Le mode `split` n'est offert qu'au-dessus du breakpoint desktop (≥1100px) ;
 * c'est l'appelant qui décide d'afficher ou non le bouton via `showSplit`.
 *
 * Cf. issue #123.
 */
type Props = {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  /** Affiche le bouton "split" — typiquement masqué sur mobile (<1100px) où
   * le 3-cols ne tient pas. Par défaut true. */
  showSplit?: boolean;
  className?: string;
};

export function ViewModeToggle({
  mode,
  onChange,
  showSplit = true,
  className,
}: Props) {
  const t = useTranslations("map.viewMode");

  const buttons: Array<{
    key: ViewMode;
    label: string;
    Icon: typeof MapIcon;
    visible: boolean;
  }> = [
    { key: "map", label: t("map"), Icon: MapIcon, visible: true },
    { key: "list", label: t("list"), Icon: List, visible: true },
    { key: "split", label: t("split"), Icon: Columns, visible: showSplit },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("toggleLabel")}
      className={`inline-flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow-md backdrop-blur ${className ?? ""}`}
    >
      {buttons
        .filter((b) => b.visible)
        .map(({ key, label, Icon }) => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={label}
              title={label}
              onClick={() => onChange(key)}
              className={`flex h-8 w-8 items-center justify-center rounded transition ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
    </div>
  );
}
