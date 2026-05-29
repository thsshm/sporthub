"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Crosshair, List, SlidersHorizontal, X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { SportFilters, type CriteriaKey } from "@/app/[locale]/map/SportFilters";
import { EmptyStateOverlay } from "@/app/[locale]/map/EmptyStateOverlay";
import { ViewModeToggle } from "@/app/[locale]/map/ViewModeToggle";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import {
  isViewMode,
  loadAutoUpdate,
  loadViewMode,
  loadViewport,
  saveAutoUpdate,
  saveViewMode,
  type ViewMode,
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

// Breakpoint en dessous duquel le mode `split` retombe en `map`. Doit matcher
// la grille CSS ci-dessous (320px filtres + carte + 380px liste = ~1080px min).
const SPLIT_MIN_PX = 1100;

type Props = {
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  /** Venues pré-fetched côté Server pour le LCP. Affichés immédiatement avant
   * que le bbox-aware fetch client retourne. */
  initialVenues?: VenuePin[];
  /** Slug famille passé via ?family=X dans l'URL (lu côté Server par page.tsx
   * pour éviter le bailout dynamic de useSearchParams). Cf. #121. */
  initialFamily?: string | null;
  /** Mode d'affichage passé via ?view=X dans l'URL (lu côté Server). Cf. #123.
   * URL prioritaire sur localStorage si présent et valide. */
  initialViewMode?: ViewMode | null;
};

export function MapWithSearch({
  initialLat,
  initialLon,
  initialZoom,
  initialVenues,
  initialFamily,
  initialViewMode,
}: Props) {
  const tMap = useTranslations("map");
  const tView = useTranslations("map.viewMode");

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

  // Init du switcher #121 depuis ?family=X (lu côté Server par page.tsx).
  // Si valide → on init avec cette seule famille. Sinon = toutes.
  const router = useRouter();
  const pathname = usePathname();
  const validInitialFamily =
    initialFamily && FAMILIES.some((f) => f.slug === initialFamily)
      ? initialFamily
      : null;

  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(() =>
    validInitialFamily
      ? new Set([validInitialFamily])
      : new Set(FAMILIES.map((f) => f.slug)),
  );

  // Sync URL ↔ selectedFamilies. Si on est en mode "1 famille" → push
  // ?family=X. Sinon (0 ou multi ou toutes) → retirer le param.
  // router.replace évite de polluer l'historique (cf. pattern V1).
  // NB: on lit window.location pour préserver les éventuels autres params
  // (futurs ?sports=, ?view=…) sans wrapper la page dans <Suspense>.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selectedFamilies.size === 1) {
      const slug = Array.from(selectedFamilies)[0];
      if (params.get("family") !== slug) {
        params.set("family", slug);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } else if (params.has("family")) {
      params.delete("family");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFamilies]);

  // Mode d'affichage carte / liste / split (#123).
  // Précédence (du plus fort au plus faible) : URL (?view=…) > localStorage > "map".
  // initialViewMode est résolu côté Server par page.tsx pour éviter Suspense.
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (initialViewMode && isViewMode(initialViewMode)) return initialViewMode;
    return loadViewMode() ?? "map";
  });

  // Wrapper qui persiste + sync URL. Le push ?view=X passe par router.replace
  // pour ne pas polluer l'historique. On préserve les autres params (?family=…).
  const setViewMode = (next: ViewMode) => {
    setViewModeState(next);
    saveViewMode(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next === "map") {
      // map = défaut → on retire le param pour garder l'URL propre.
      if (params.has("view")) {
        params.delete("view");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    } else if (params.get("view") !== next) {
      params.set("view", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  };

  // Détection responsive : si la fenêtre est < SPLIT_MIN_PX et mode = split,
  // on retombe en `map` côté UI (mais on garde la valeur `split` en storage
  // pour retrouver le 3-cols au redimensionnement). On utilise matchMedia
  // plutôt que window.innerWidth pour réagir au resize/rotation device.
  const [isWideEnoughForSplit, setIsWideEnoughForSplit] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${SPLIT_MIN_PX}px)`);
    setIsWideEnoughForSplit(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsWideEnoughForSplit(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** Mode effectivement appliqué à l'UI — `split` est dégradé en `map`
   * sur les écrans étroits. */
  const effectiveMode: ViewMode =
    viewMode === "split" && !isWideEnoughForSplit ? "map" : viewMode;

  const [selectedCriteria, setSelectedCriteria] = useState<Set<CriteriaKey>>(
    () => new Set(),
  );
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(() =>
    loadAutoUpdate(true),
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Drawer "Liste" mobile (#123) — disponible quand l'user est en mode `split`
  // mais que l'écran est trop étroit, ou simplement pour consulter la liste
  // sans quitter le mode `map`.
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);
  const [geolocError, setGeolocError] = useState<string | null>(null);
  // Liste des venues + centre courant remontés par MapClient (#123). Permet à
  // VenueListPanel d'afficher / trier sans re-fetch.
  const [venuesData, setVenuesData] = useState<{
    venues: VenuePin[];
    center: { lat: number; lon: number };
  }>({
    venues: initialVenues ?? [],
    center: { lat: initialView.lat, lon: initialView.lon },
  });

  // Wrapper qui persiste le toggle autoUpdate.
  const setAutoUpdate = (v: boolean) => {
    setAutoUpdateState(v);
    saveAutoUpdate(v);
  };

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

  // Clic d'une card en mode split : fly-to sur la venue. L'user reste sur /map ;
  // le popup éventuel est géré par MapClient au prochain clic pin (en l'absence
  // d'une prop "openVenuePopup" dédiée, garder simple).
  const handleVenueFly = (venue: VenuePin) => {
    setFlyTarget({ lat: venue.lat, lon: venue.lon, zoom: 14, token: Date.now() });
  };

  return (
    <div className="relative h-full w-full">
      {/* ======================================================================
          MODE LIST : pleine page, sans carte montée — on évite ainsi le coût
          MapLibre quand l'user est purement en navigation liste. La liste se
          base sur le dernier état remonté par MapClient avant le switch.
          Acceptable pour V1 ; à raffiner si besoin.
          ====================================================================== */}
      {effectiveMode === "list" && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background">
          <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <ViewModeToggle
              mode={viewMode}
              onChange={setViewMode}
              showSplit={isWideEnoughForSplit}
            />
            <SearchBar
              onSelect={(r) =>
                setFlyTarget({
                  lat: r.lat,
                  lon: r.lon,
                  zoom: 12,
                  token: Date.now(),
                })
              }
              className="ml-auto w-full max-w-xs"
            />
          </header>
          <VenueListPanel
            venues={venuesData.venues}
            center={venuesData.center}
            interaction="navigate"
            className="flex-1 overflow-hidden"
          />
        </div>
      )}

      {/* ======================================================================
          MODE SPLIT (desktop ≥ 1100px) : 3 colonnes filtres / carte / liste
          en grille CSS. Filtres et liste ne se superposent pas à la carte.
          ====================================================================== */}
      {effectiveMode === "split" && (
        <div
          className="absolute inset-0 z-10 grid bg-background"
          style={{ gridTemplateColumns: "320px 1fr 380px" }}
        >
          {/* Colonne 1 : filtres en colonne propre (vs overlay absolute) */}
          <div className="flex flex-col overflow-hidden border-r">
            <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <ViewModeToggle
                mode={viewMode}
                onChange={setViewMode}
                showSplit={isWideEnoughForSplit}
              />
            </header>
            <SportFilters
              selected={selectedFamilies}
              onChange={setSelectedFamilies}
              selectedCriteria={selectedCriteria}
              onCriteriaChange={setSelectedCriteria}
              autoUpdate={autoUpdate}
              onAutoUpdateChange={setAutoUpdate}
              className="m-3 overflow-auto"
            />
          </div>
          {/* Colonne 2 : carte. Wrapper position-relative pour ancrer les
              overlays SearchBar / "Ma position" / count à la carte. */}
          <div className="relative overflow-hidden">
            <SearchBar
              onSelect={(r) =>
                setFlyTarget({
                  lat: r.lat,
                  lon: r.lon,
                  zoom: 12,
                  token: Date.now(),
                })
              }
              className="absolute right-4 top-4 z-20 w-80"
            />
            <button
              type="button"
              onClick={handleMyLocation}
              aria-label={tMap("myLocation")}
              title={tMap("myLocation")}
              className="absolute bottom-16 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-md backdrop-blur hover:bg-accent"
            >
              <Crosshair className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-background/90 px-3 py-2 text-sm shadow-md backdrop-blur">
              <span className="font-semibold">{formatCount(visibleCount)}</span>{" "}
              spots dans la vue
            </div>
            <EmptyStateOverlay
              count={visibleCount}
              zoom={currentZoom}
              selectedFamilies={selectedFamilies}
              totalFamilies={FAMILIES.length}
              selectedCriteria={selectedCriteria}
            />
            <MapClient
              initialLat={initialView.lat}
              initialLon={initialView.lon}
              initialZoom={initialView.zoom}
              selectedFamilies={selectedFamilies}
              totalFamilies={FAMILIES.length}
              selectedCriteria={selectedCriteria}
              autoUpdate={autoUpdate}
              onVenuesChange={setVisibleCount}
              onVenuesData={(venues, center) =>
                setVenuesData({ venues, center })
              }
              onZoomChange={setCurrentZoom}
              flyTarget={flyTarget}
              initialVenues={effectiveInitialVenues}
            />
          </div>
          {/* Colonne 3 : liste */}
          <VenueListPanel
            venues={venuesData.venues}
            center={venuesData.center}
            interaction="fly"
            onVenueClick={handleVenueFly}
            className="overflow-hidden border-l"
          />
        </div>
      )}

      {/* ======================================================================
          MODE MAP : layout original (overlays absolus sur la carte). Garde
          aussi le comportement responsive mobile (drawer filtres + drawer liste).
          ====================================================================== */}
      {effectiveMode === "map" && (
        <>
          {/* Sidebar desktop */}
          <SportFilters
            selected={selectedFamilies}
            onChange={setSelectedFamilies}
            selectedCriteria={selectedCriteria}
            onCriteriaChange={setSelectedCriteria}
            autoUpdate={autoUpdate}
            onAutoUpdateChange={setAutoUpdate}
            className="absolute left-4 top-4 z-20 hidden max-h-[calc(100%-2rem)] w-56 overflow-auto md:flex"
          />

          {/* Bouton filtres mobile */}
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Ouvrir les filtres"
            className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-sm shadow-md backdrop-blur md:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filtres
          </button>

          {/* Drawer filtres mobile */}
          {mobileFiltersOpen && (
            <div
              className="absolute inset-0 z-30 md:hidden"
              role="dialog"
              aria-modal="true"
            >
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

          {/* Toggle modes — toujours visible en haut, centré */}
          <ViewModeToggle
            mode={viewMode}
            onChange={setViewMode}
            showSplit={isWideEnoughForSplit}
            className="absolute left-1/2 top-4 z-20 -translate-x-1/2"
          />

          <SearchBar
            onSelect={(r) =>
              setFlyTarget({
                lat: r.lat,
                lon: r.lon,
                zoom: 12,
                token: Date.now(),
              })
            }
            className="absolute right-4 top-4 z-20 w-[min(320px,calc(100vw-180px))] md:w-80"
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

          {/* Bouton "Liste" — ouvre le drawer bottom sheet. Pertinent surtout
              quand l'user a demandé split mais que l'écran est trop étroit
              (l'effectiveMode est alors `map`), ou pour consulter la liste
              ponctuellement sans switcher de mode. */}
          <button
            type="button"
            onClick={() => setMobileListOpen(true)}
            aria-label={tView("openListDrawer")}
            title={tView("openListDrawer")}
            className="absolute bottom-4 right-4 z-20 flex h-10 items-center gap-1.5 rounded-md border bg-background/95 px-3 text-sm font-medium text-foreground shadow-md backdrop-blur hover:bg-accent"
          >
            <List className="h-4 w-4" aria-hidden="true" />
            {tView("list")}
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
            <span className="font-semibold">{formatCount(visibleCount)}</span>{" "}
            spots dans la vue
          </div>

          <EmptyStateOverlay
            count={visibleCount}
            zoom={currentZoom}
            selectedFamilies={selectedFamilies}
            totalFamilies={FAMILIES.length}
            selectedCriteria={selectedCriteria}
          />

          <MapClient
            initialLat={initialView.lat}
            initialLon={initialView.lon}
            initialZoom={initialView.zoom}
            selectedFamilies={selectedFamilies}
            totalFamilies={FAMILIES.length}
            selectedCriteria={selectedCriteria}
            autoUpdate={autoUpdate}
            onVenuesChange={setVisibleCount}
            onVenuesData={(venues, center) =>
              setVenuesData({ venues, center })
            }
            onZoomChange={setCurrentZoom}
            flyTarget={flyTarget}
            initialVenues={effectiveInitialVenues}
          />

          {/* Drawer "Liste" mobile bottom sheet — affiché par-dessus la carte */}
          {mobileListOpen && (
            <div
              className="absolute inset-0 z-40"
              role="dialog"
              aria-modal="true"
              aria-label={tView("listLabel")}
            >
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setMobileListOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 flex max-h-[75vh] flex-col rounded-t-xl bg-background shadow-lg">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-sm font-semibold">
                    {tView("listLabel")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileListOpen(false)}
                    aria-label={tView("closeListDrawer")}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <VenueListPanel
                  venues={venuesData.venues}
                  center={venuesData.center}
                  interaction="fly"
                  onVenueClick={(v) => {
                    handleVenueFly(v);
                    setMobileListOpen(false);
                  }}
                  className="flex-1 overflow-hidden"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
