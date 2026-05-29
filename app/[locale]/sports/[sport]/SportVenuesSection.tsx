"use client";

/**
 * Wrapper client de la section carte + liste sur /sports/[sport]. Issue #98.
 *
 * Deux patterns d'affichage de la liste, basculés par un toggle :
 *
 *   1. "Tous les venues" (défaut) — la grille de VenueCard rendue côté
 *      serveur (passée en `children`). C'est la liste ancrée, paginée,
 *      indexable par Google (ItemList JSON-LD) et fonctionnelle sans JS.
 *
 *   2. "Dans cette vue" — liste dynamique qui suit le viewport de la carte.
 *      Réutilise <VenueListPanel> (#123) : reçoit les venues déjà fetchés
 *      par la carte via onVenuesData (aucun double appel API), triés par
 *      distance au centre. Clic sur un item → flyTo sur la carte.
 *
 * Le mode par défaut reste "ancré" pour préserver le SEO et le no-JS ;
 * le mode viewport est une amélioration progressive côté client. Cf. le
 * trade-off décrit dans l'issue #98 ("liste statique ancrée" vs "liste
 * dynamique selon viewport") : on expose les deux, l'utilisateur choisit.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { VenuePin } from "@/lib/supabase/types";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { SportPageMap } from "./SportPageMap";

type Mode = "all" | "view";

type Props = {
  sportSlug: string;
  initialVenues: VenuePin[];
  totalSportVenues: number;
  /** Hint sous la carte, déjà traduit côté serveur. */
  mapHint: string;
  /** Grille de VenueCard + pagination, rendues côté serveur (mode ancré). */
  children: React.ReactNode;
};

export function SportVenuesSection({
  sportSlug,
  initialVenues,
  totalSportVenues,
  mapHint,
  children,
}: Props) {
  const t = useTranslations("sport");
  const [mode, setMode] = useState<Mode>("all");
  const [viewportVenues, setViewportVenues] = useState<VenuePin[]>(initialVenues);
  const [center, setCenter] = useState<{ lat: number; lon: number }>(() => {
    if (initialVenues.length === 0) return { lat: 46.5, lon: 2.5 };
    const lat =
      initialVenues.reduce((s, v) => s + v.lat, 0) / initialVenues.length;
    const lon =
      initialVenues.reduce((s, v) => s + v.lon, 0) / initialVenues.length;
    return { lat, lon };
  });
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);

  const handleVenuesData = useCallback(
    (venues: VenuePin[], c: { lat: number; lon: number }) => {
      setViewportVenues(venues);
      setCenter(c);
    },
    [],
  );

  const handleSelect = useCallback((v: VenuePin) => {
    setFlyTarget({ lat: v.lat, lon: v.lon, zoom: 15, token: Date.now() });
  }, []);

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 font-medium transition ${
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mt-6">
      <SportPageMap
        sportSlug={sportSlug}
        initialVenues={initialVenues}
        totalSportVenues={totalSportVenues}
        onVenuesData={handleVenuesData}
        flyTarget={flyTarget}
      />
      <p className="mt-2 text-xs text-muted-foreground">{mapHint}</p>

      {/* Toggle des deux patterns de liste (#98). */}
      <div className="mt-6 flex items-center gap-3">
        <div
          role="tablist"
          aria-label={t("listModeAll")}
          className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "all"}
            onClick={() => setMode("all")}
            className={tabClass(mode === "all")}
          >
            {t("listModeAll")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "view"}
            onClick={() => setMode("view")}
            className={tabClass(mode === "view")}
          >
            {t("listModeViewport", { count: viewportVenues.length })}
          </button>
        </div>
        {mode === "view" && (
          <p className="text-xs text-muted-foreground">{t("viewportHint")}</p>
        )}
      </div>

      <div className="mt-6">
        {mode === "all" ? (
          children
        ) : (
          <VenueListPanel
            venues={viewportVenues}
            center={center}
            onSelect={handleSelect}
            className="max-h-[600px] rounded-lg border"
          />
        )}
      </div>
    </div>
  );
}
