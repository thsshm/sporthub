"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Crosshair, SlidersHorizontal, X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { FamilySwitcher } from "@/components/map/FamilySwitcher";
import { SportFilters, type CriteriaKey } from "@/app/[locale]/map/SportFilters";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import {
  loadAutoUpdate,
  loadViewport,
  saveAutoUpdate,
} from "@/lib/map-storage";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import type { VenuePin } from "@/lib/supabase/types";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
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
        Chargement de la carte…
      </div>
    </div>
  ),
});

type Props = {
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  /** Venues pré-fetched côté Server pour le LCP. Affichés immédiatement avant
   * que le bbox-aware fetch client retourne. */
  initialVenues?: VenuePin[];
};

export function MapWithSearch({
  initialLat,
  initialLon,
  initialZoom,
  initialVenues,
}: Props) {
  const tMap = useTranslations("map");

  // Persistance viewport : si l'utilisateur revient sur /map, on restaure sa
  // dernière position (lazy init useState pour ne lire localStorage qu'une fois).
  // Si pas de viewport sauvé, on utilise les props passées par le Server (France).
  // NB: si viewport restauré ≠ initial Server, initialVenues (SSR pre-fetch
  // France) devient non pertinent → MapClient devra re-fetcher pour la nouvelle
  // zone. C'est OK : un seul roundtrip /api/venues.
  const [initialView] = useState(() => {
    const saved = loadViewport();
    if (saved) {
      return { lat: saved.lat, lon: saved.lon, zoom: saved.zoom, restored: true };
    }
    return { lat: initialLat, lon: initialLon, zoom: initialZoom, restored: false };
  });

  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(
    () => new Set(FAMILIES.map((f) => f.slug)),
  );
  // Famille active du switcher rapide (#121). `null` = "Toutes les familles".
  // C'est une projection mono-famille au-dessus de `selectedFamilies` (qui reste
  // multi-sélection via la sidebar / les checkboxes). Quand l'user clique un
  // chip, on bascule `selectedFamilies` en mode "uniquement ce slug" et on
  // reset les critères pour repartir d'une exploration propre.
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [selectedCriteria, setSelectedCriteria] = useState<Set<CriteriaKey>>(
    () => new Set(),
  );
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(() =>
    loadAutoUpdate(true),
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [geolocError, setGeolocError] = useState<string | null>(null);

  // Wrapper qui persiste le toggle autoUpdate.
  const setAutoUpdate = (v: boolean) => {
    setAutoUpdateState(v);
    saveAutoUpdate(v);
  };

  // Handler du FamilySwitcher (#121). Une seule famille à la fois OU null = toutes.
  // - null  → reset à "toutes cochées" (équivalent du bouton "tout" de la sidebar).
  // - slug  → uniquement ce slug coché dans la sidebar.
  // Dans les deux cas, on vide les critères universels (lit/indoor/…) pour que
  // l'user reparte d'une exploration propre — cf. issue #121 "vide les
  // sélections sport précédentes".
  const handleFamilyChange = useCallback((slug: string | null) => {
    setActiveFamily(slug);
    if (slug === null) {
      setSelectedFamilies(new Set(FAMILIES.map((f) => f.slug)));
    } else {
      setSelectedFamilies(new Set([slug]));
    }
    setSelectedCriteria(new Set());
  }, []);

  // Auto-clear geolocError après 4s.
  useEffect(() => {
    if (!geolocError) return;
    const handle = setTimeout(() => setGeolocError(null), 4000);
    return () => clearTimeout(handle);
  }, [geolocError]);

  // Si viewport restauré, on n'envoie PAS initialVenues à MapClient
  // (les venues France SSR-pre-fetched ne correspondent pas à la zone restaurée).
  const effectiveInitialVenues = useMemo(
    () => (initialView.restored ? undefined : initialVenues),
    [initialView.restored, initialVenues],
  );

  // Bouton "Ma position" — demande la géolocalisation navigateur puis flyTo.
  const handleMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeolocError(tMap("myLocationUnavailable"));
      return;
    }
    setGeolocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFlyTarget({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          zoom: 12,
          token: Date.now(),
        });
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setGeolocError(
          err.code === 1
            ? tMap("myLocationDenied")
            : tMap("myLocationUnavailable"),
        );
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="relative h-full w-full">
      {/* FamilySwitcher #121 — bandeau famille rapide en haut de la carte.
          Desktop : top bar pleine largeur, sticky.
          Mobile  : pareil, scroll horizontal interne au composant.
          Tous les autres overlays démarrent ~3.5rem plus bas pour ne pas
          le recouvrir. */}
      <FamilySwitcher
        activeFamily={activeFamily}
        onFamilyChange={handleFamilyChange}
        className="absolute left-2 right-2 top-2 z-30 md:left-4 md:right-4 md:top-4"
      />

      {/* Sidebar desktop — décalée sous le switcher */}
      <SportFilters
        selected={selectedFamilies}
        onChange={setSelectedFamilies}
        selectedCriteria={selectedCriteria}
        onCriteriaChange={setSelectedCriteria}
        autoUpdate={autoUpdate}
        onAutoUpdateChange={setAutoUpdate}
        className="absolute left-4 top-20 z-20 hidden max-h-[calc(100%-6rem)] w-56 overflow-auto md:flex"
      />

      {/* Bouton filtres mobile — décalé sous le switcher */}
      <button
        type="button"
        onClick={() => setMobileFiltersOpen(true)}
        aria-label="Ouvrir les filtres"
        className="absolute left-2 top-16 z-20 flex items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-sm shadow-md backdrop-blur md:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filtres
      </button>

      {/* Drawer filtres mobile */}
      {mobileFiltersOpen && (
        <div className="absolute inset-0 z-30 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Filtres familles</span>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Fermer les filtres"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <SportFilters
                selected={selectedFamilies}
                onChange={setSelectedFamilies}
                selectedCriteria={selectedCriteria}
                onCriteriaChange={setSelectedCriteria}
                autoUpdate={autoUpdate}
                onAutoUpdateChange={setAutoUpdate}
                className="border-0 p-0 shadow-none"
              />
            </div>
          </div>
        </div>
      )}

      <SearchBar
        onSelect={(r) =>
          setFlyTarget({ lat: r.lat, lon: r.lon, zoom: 12, token: Date.now() })
        }
        className="absolute right-2 top-16 z-20 w-[min(320px,calc(100vw-100px))] md:right-4 md:top-20 md:w-80"
      />

      {/* Bouton "Ma position" (géolocalisation navigateur) */}
      <button
        type="button"
        onClick={handleMyLocation}
        aria-label={tMap("myLocation")}
        title={tMap("myLocation")}
        className="absolute bottom-16 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-md backdrop-blur hover:bg-accent"
      >
        <Crosshair className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Toast erreur géolocalisation */}
      {geolocError && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-32 right-4 z-30 max-w-xs rounded-md border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
        >
          {geolocError}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-background/90 px-3 py-2 text-sm shadow-md backdrop-blur md:left-64">
        <span className="font-semibold">{formatCount(visibleCount)}</span> spots dans la vue
      </div>

      <MapClient
        initialLat={initialView.lat}
        initialLon={initialView.lon}
        initialZoom={initialView.zoom}
        selectedFamilies={selectedFamilies}
        totalFamilies={FAMILIES.length}
        selectedCriteria={selectedCriteria}
        autoUpdate={autoUpdate}
        onVenuesChange={setVisibleCount}
        flyTarget={flyTarget}
        initialVenues={effectiveInitialVenues}
      />
    </div>
  );
}
