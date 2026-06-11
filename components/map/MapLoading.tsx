"use client";

import { useTranslations } from "next-intl";

/**
 * État de chargement de la carte — LOCALISÉ (#611).
 *
 * Les `loading: () => …` des `dynamic(import(MapClient))` affichaient
 * « Chargement de la carte… » en français codé en dur, même sur /en et /zh.
 * Ce composant client lit `map.loading` (traduit fr/en/zh) → texte cohérent
 * avec la langue.
 *
 * Deux variantes pour conserver les visuels existants :
 *   - "plain"   : simple message centré (fiche club, page sport, retraites) ;
 *   - "spinner" : message + spinner sur pastille (carte principale).
 */
export function MapLoading({
  variant = "plain",
}: {
  variant?: "plain" | "spinner";
}) {
  const t = useTranslations("map");
  const label = t("loading");

  if (variant === "spinner") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/20">
        <div className="flex items-center gap-2 rounded-md bg-background/95 px-4 py-2 text-sm text-muted-foreground shadow-md backdrop-blur">
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="60"
              strokeDashoffset="40"
              strokeLinecap="round"
            />
          </svg>
          {label}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
