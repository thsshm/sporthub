"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { VenuePin } from "@/lib/supabase/types";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import { formatCount } from "@/lib/utils";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

/** Vue de repli quand la géoloc IP est indisponible (dev local, headers Vercel
 * absents) : France entière. Volontairement PAS une vue monde — cf. #455. */
const FRANCE_FALLBACK = { lat: 46.5, lon: 2.5, zoom: 5 } as const;
/** Zoom d'ouverture quand on connaît la région du visiteur : assez serré pour
 * être en mode POI (pins individuels du sport), pas en agrégats. */
const GEO_ZOOM = 12;

type View = { lat: number; lon: number; zoom: number };

type Props = {
  /** Slug du sport pour le filtrage côté API (mode bbox-aware) */
  sportSlug: string;
  /** Venues initiaux (les 24 de la page courante) — alimentent le compteur
   * « visible » avant le premier fetch bbox-aware. */
  initialVenues: VenuePin[];
  /** Total venues du sport (pour l'overlay info). */
  totalSportVenues?: number;
  /** Reporte au parent la liste des venues visibles + le centre courant,
   * pour la liste viewport-synced (#98). */
  onVenuesData?: (venues: VenuePin[], center: { lat: number; lon: number }) => void;
  /** Cible de flyTo (clic sur un item de la liste viewport). */
  flyTarget?: FlyTarget | null;
};

/**
 * Carte filtrée par sport sur /sports/[sport], avec bbox-aware fetch
 * (`/api/venues?sport=X&bbox=…`).
 *
 * Vue initiale (fix #455) : on résout la géoloc IP (`/api/geo`, edge, rapide)
 * AVANT de monter MapLibre, puis on ouvre la carte directement sur la région du
 * visiteur au zoom POI → les pins du sport sont visibles d'emblée.
 *
 * Pourquoi pas l'ancien calcul « span des venues SSR » + flyTo de recentrage :
 *   - les 24 venues SSR (premiers par `id`) sont dispersés sur ~86° de longitude
 *     → `span > 50 → zoom 2` → la carte ouvrait sur une vue MONDE en agrégats,
 *     indistinguable d'un « tous sports » (l'utilisateur croyait le filtre cassé).
 *   - le recentrage géoloc passait bien `flyTarget` à MapClient mais le `flyTo`
 *     initial était perdu dans la course au chargement (carte jamais recentrée).
 * La carte principale /map n'a pas ce souci car elle reçoit sa vue initiale
 * depuis la géoloc IP SSR ; ici on fait l'équivalent côté client (la page sport
 * est en ISR, on ne veut pas la rendre dynamique pour lire les headers).
 */
export function SportPageMap({
  sportSlug,
  initialVenues,
  totalSportVenues,
  onVenuesData,
  flyTarget,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(initialVenues.length);

  // Vue d'ouverture résolue depuis /api/geo. `null` = pas encore résolue → on
  // n'a pas encore monté MapLibre (évite d'ouvrir sur une vue monde puis sauter).
  const [initialView, setInitialView] = useState<View | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Filet : si /api/geo traîne (>800 ms), on ouvre sur la France plutôt que de
    // bloquer l'affichage de la carte indéfiniment.
    const timer = setTimeout(() => {
      if (!cancelled) setInitialView((v) => v ?? { ...FRANCE_FALLBACK });
    }, 800);
    (async () => {
      try {
        const res = await fetch("/api/geo");
        const data = res.ok
          ? ((await res.json()) as { geo: { lat: number; lon: number } | null })
          : { geo: null };
        if (cancelled) return;
        setInitialView(
          data.geo
            ? { lat: data.geo.lat, lon: data.geo.lon, zoom: GEO_ZOOM }
            : { ...FRANCE_FALLBACK },
        );
      } catch {
        if (!cancelled) setInitialView({ ...FRANCE_FALLBACK });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="relative h-[400px] w-full overflow-hidden rounded-lg border">
      {initialView ? (
        <MapClient
          initialLat={initialView.lat}
          initialLon={initialView.lon}
          initialZoom={initialView.zoom}
          selectedSport={sportSlug}
          onVenuesChange={setVisibleCount}
          onVenuesData={onVenuesData}
          flyTarget={flyTarget}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
          Chargement de la carte…
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-background/90 px-2 py-1 text-[11px] shadow backdrop-blur">
        <span className="font-semibold">{formatCount(visibleCount)}</span> visible
        {totalSportVenues != null && (
          <>
            {" "}
            / <span>{formatCount(totalSportVenues)}</span> total
          </>
        )}
      </div>
    </div>
  );
}
