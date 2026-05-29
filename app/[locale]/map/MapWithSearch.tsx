"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Crosshair, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import {
  ExplorePicker,
  type PickerSelection,
} from "@/components/map/ExplorePicker";
import { SportFilters, type CriteriaKey } from "@/app/[locale]/map/SportFilters";
import { EmptyStateOverlay } from "@/app/[locale]/map/EmptyStateOverlay";
import { ViewModeToggle } from "@/app/[locale]/map/ViewModeToggle";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import {
  isViewMode,
  loadAutoUpdate,
  loadPickerSeen,
  loadViewMode,
  loadViewport,
  saveAutoUpdate,
  savePickerSeen,
  saveViewMode,
  type ViewMode,
} from "@/lib/map-storage";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import type { VenuePin } from "@/lib/supabase/types";

/** Breakpoint en dessous duquel "split" retombe en "map" (le panneau liste
 * passerait sinon par-dessus la carte sur étroit). Matche le min desktop V1. */
const SPLIT_MIN_PX = 1100;

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
  /** Slug famille passé via ?family=X dans l'URL (lu côté Server par page.tsx
   * pour éviter le bailout dynamic de useSearchParams). Cf. #121. */
  initialFamily?: string | null;
  /** Liste CSV de slugs familles passée via ?sports=X,Y (#132 mode multi).
   * Prioritaire sur initialFamily si présent. */
  initialSports?: string | null;
  /** Mode d'affichage initial (?view=X dans l'URL, lu côté Server). Cf. #123.
   * URL prioritaire sur localStorage si valide. */
  initialViewMode?: ViewMode | null;
  /** Quand true, l'URL contient déjà une intention (family/sports/lat/q)
   * et le picker explore (#132) ne s'affiche pas, même au premier visit. */
  hasUrlIntent?: boolean;
};

export function MapWithSearch({
  initialLat,
  initialLon,
  initialZoom,
  initialVenues,
  initialFamily,
  initialSports,
  initialViewMode,
  hasUrlIntent,
}: Props) {
  const tMap = useTranslations("map");
  const tPicker = useTranslations("map.explore");

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
  // Si valide → on init avec cette seule famille.
  // Pour #132 : ?sports=X,Y a priorité, init avec ces N familles.
  // Sinon = toutes.
  const router = useRouter();
  const pathname = usePathname();
  const validInitialFamily =
    initialFamily && FAMILIES.some((f) => f.slug === initialFamily)
      ? initialFamily
      : null;
  const validInitialSports = useMemo(() => {
    if (!initialSports) return null;
    const valid = initialSports
      .split(",")
      .map((s) => s.trim())
      .filter((s) => FAMILIES.some((f) => f.slug === s));
    return valid.length > 0 ? valid : null;
  }, [initialSports]);

  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(() => {
    if (validInitialSports) return new Set(validInitialSports);
    if (validInitialFamily) return new Set([validInitialFamily]);
    return new Set(FAMILIES.map((f) => f.slug));
  });

  // Sync URL ↔ selectedFamilies. 3 cas :
  //   - 1 famille → ?family=X (mode "switcher" #121)
  //   - 2..N-1 familles → ?sports=X,Y,... (mode "multi" #132)
  //   - 0 ou TOUTES familles → ni l'un ni l'autre (URL propre)
  // router.replace évite de polluer l'historique (cf. pattern V1).
  // NB: on lit window.location pour préserver les éventuels autres params
  // (?view=…, ?q=…) sans wrapper la page dans <Suspense>.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const size = selectedFamilies.size;
    const total = FAMILIES.length;
    let changed = false;
    if (size === 1) {
      const slug = Array.from(selectedFamilies)[0];
      if (params.get("family") !== slug) {
        params.set("family", slug);
        changed = true;
      }
      if (params.has("sports")) {
        params.delete("sports");
        changed = true;
      }
    } else if (size >= 2 && size < total) {
      const csv = Array.from(selectedFamilies).sort().join(",");
      if (params.get("sports") !== csv) {
        params.set("sports", csv);
        changed = true;
      }
      if (params.has("family")) {
        params.delete("family");
        changed = true;
      }
    } else {
      // 0 ou toutes — on retire les deux params
      if (params.has("family")) {
        params.delete("family");
        changed = true;
      }
      if (params.has("sports")) {
        params.delete("sports");
        changed = true;
      }
    }
    if (changed) {
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFamilies]);


  const [selectedCriteria, setSelectedCriteria] = useState<Set<CriteriaKey>>(
    () => new Set(),
  );
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(() =>
    loadAutoUpdate(true),
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);
  const [geolocError, setGeolocError] = useState<string | null>(null);

  // Picker explore (#132). Le 1er visit sur /map "nu" (sans ?family, ?sports,
  // ?lat ou ?q dans l'URL) affiche un overlay full-screen pour que l'user
  // choisisse ses familles. Une fois validé, on stocke `sporthub-picker-seen`
  // en localStorage pour ne plus reprompter.
  //
  // SSR : on initialise à false pour ne pas mismatch hydratation (le serveur
  // ne sait pas si l'user a déjà vu le picker). On résout dans un useEffect.
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  // Track séparé : a-t-on déjà validé une fois ? Détermine si le picker est
  // fermable (✕/Annuler) — au tout premier visit on force le choix.
  const [pickerSeen, setPickerSeen] = useState<boolean>(false);
  useEffect(() => {
    // Lecture localStorage cliente uniquement, après hydration.
    const seen = loadPickerSeen();
    setPickerSeen(seen);
    // Si l'URL contient une intention (family/sports/lat/q) → skip picker,
    // peu importe le storage (l'user a un lien direct).
    if (hasUrlIntent) return;
    // Sinon : afficher le picker UNIQUEMENT si jamais vu.
    if (!seen) setPickerOpen(true);
  }, [hasUrlIntent]);

  // Validation du picker : applique sélection familles + ville, persiste le
  // flag "vu", ferme l'overlay, et redirige vers une URL canonique pour
  // partage (pattern V1).
  const handlePickerSubmit = (selection: PickerSelection) => {
    setSelectedFamilies(selection.families);
    if (selection.city) {
      setFlyTarget({
        lat: selection.city.lat,
        lon: selection.city.lon,
        zoom: 12,
        token: Date.now(),
      });
    }
    savePickerSeen(true);
    setPickerSeen(true);
    setPickerOpen(false);

    // Construire l'URL : ?family=X ou ?sports=X,Y + ?q=ville si présente.
    // Le useEffect [selectedFamilies] gérera aussi ce push mais on le fait
    // ici pour pouvoir ajouter ?q= en même temps (atomique pour partage).
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const size = selection.families.size;
    const total = FAMILIES.length;
    params.delete("family");
    params.delete("sports");
    if (size === 1) {
      params.set("family", Array.from(selection.families)[0]);
    } else if (size >= 2 && size < total) {
      params.set("sports", Array.from(selection.families).sort().join(","));
    }
    if (selection.city) {
      params.set("q", selection.city.name);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Bouton "Changer ma sélection 🔄" — rouvre le picker. On ne reset pas le
  // flag picker-seen côté storage : c'est juste un re-prompt à la demande.
  const handleReopenPicker = () => {
    setPickerOpen(true);
  };

  // Mode d'affichage carte / liste / split (#123).
  // Précédence : URL (?view=…) → localStorage → "map" par défaut.
  // initialViewMode est résolu côté Server par page.tsx pour éviter Suspense.
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (initialViewMode && isViewMode(initialViewMode)) return initialViewMode;
    return loadViewMode() ?? "map";
  });

  // Wrapper qui persiste + sync URL via router.replace (pas d'historique).
  const setViewMode = (next: ViewMode) => {
    setViewModeState(next);
    saveViewMode(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next === "map") {
      // map = défaut → on retire le param pour garder l'URL propre
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

  // Détection responsive : sur < 1100px, "split" retombe en "map" côté UI
  // (mais on garde la valeur "split" en storage pour retrouver le 3-cols
  // au redimensionnement). matchMedia réagit au resize/rotation.
  const [isWideEnoughForSplit, setIsWideEnoughForSplit] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${SPLIT_MIN_PX}px)`);
    setIsWideEnoughForSplit(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsWideEnoughForSplit(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** Mode effectivement appliqué — split dégradé en map sur étroit. */
  const effectiveMode: ViewMode =
    viewMode === "split" && !isWideEnoughForSplit ? "map" : viewMode;

  // Snapshot venues + center reporté par MapClient pour alimenter
  // VenueListPanel sans re-fetch propre (#123).
  const [venuesSnapshot, setVenuesSnapshot] = useState<{
    venues: VenuePin[];
    center: { lat: number; lon: number };
  }>({ venues: [], center: { lat: initialLat, lon: initialLon } });

  const handleVenuesData = (
    venues: VenuePin[],
    center: { lat: number; lon: number },
  ) => {
    setVenuesSnapshot({ venues, center });
  };

  const handleListVenueSelect = (v: VenuePin) => {
    setFlyTarget({ lat: v.lat, lon: v.lon, zoom: 14, token: Date.now() });
  };

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

  return (
    <div className="relative h-full w-full">
      {/* Sidebar desktop — wrapper colonne pour caler "Changer ma sélection"
          (#132) juste sous les SportFilters. */}
      <div className="absolute left-4 top-4 z-20 hidden max-h-[calc(100%-2rem)] w-56 flex-col gap-2 overflow-auto md:flex">
        <SportFilters
          selected={selectedFamilies}
          onChange={setSelectedFamilies}
          selectedCriteria={selectedCriteria}
          onCriteriaChange={setSelectedCriteria}
          autoUpdate={autoUpdate}
          onAutoUpdateChange={setAutoUpdate}
        />
        {/* Bouton "Changer ma sélection 🔄" (#132). Toujours visible sur
            desktop sous la sidebar — permet de rouvrir le picker explore. */}
        <button
          type="button"
          onClick={handleReopenPicker}
          className="flex items-center justify-center gap-1.5 rounded-lg border bg-background/95 px-3 py-2 text-xs font-medium shadow-md backdrop-blur transition hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tPicker("changeSelection")}
        </button>
      </div>

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
              {/* Bouton "Changer ma sélection 🔄" (#132) — version mobile. */}
              <button
                type="button"
                onClick={() => {
                  setMobileFiltersOpen(false);
                  handleReopenPicker();
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs font-medium transition hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {tPicker("changeSelection")}
              </button>
            </div>
          </div>
        </div>
      )}

      <SearchBar
        onSelect={(r) =>
          setFlyTarget({ lat: r.lat, lon: r.lon, zoom: 12, token: Date.now() })
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

      {/* Empty state intelligent (#125) : overlay centré quand 0 spots dans la
          vue, avec message contextuel (zoom trop bas/haut, filtres restrictifs,
          fallback générique). Pas affiché en mode presetVenues. */}
      <EmptyStateOverlay
        count={visibleCount}
        zoom={currentZoom}
        selectedFamilies={selectedFamilies}
        totalFamilies={FAMILIES.length}
        selectedCriteria={selectedCriteria}
      />

      {/* Toggle mode d'affichage (#123) — top-right, à côté du SearchBar.
          Visible uniquement desktop (mobile garde la carte plein écran). */}
      <ViewModeToggle
        active={viewMode}
        onChange={setViewMode}
        disableSplit={!isWideEnoughForSplit}
        className="absolute right-4 top-16 z-20 hidden md:inline-flex"
      />

      {/* Panneau liste (#123) — overlay à droite en split, full-width en list.
          Toujours monté (reçoit les venues snapshot du MapClient) pour ne pas
          perdre l'état au switch de mode. CSS visibility gère le rendu. */}
      {effectiveMode !== "map" && (
        <VenueListPanel
          venues={venuesSnapshot.venues}
          center={venuesSnapshot.center}
          onSelect={handleListVenueSelect}
          className={
            effectiveMode === "split"
              ? "absolute right-0 top-0 z-10 h-full w-[380px] border-l bg-background shadow-xl"
              : "absolute inset-0 z-10 bg-background"
          }
        />
      )}

      {/* MapClient : caché en mode list (mais monté pour garder l'état MapLibre).
          En mode split, on rétrécit son conteneur pour laisser place au panel. */}
      <div
        className={
          effectiveMode === "list"
            ? "invisible h-0 w-0 overflow-hidden"
            : effectiveMode === "split"
              ? "absolute inset-y-0 left-0 right-[380px]"
              : "h-full w-full"
        }
      >
        <MapClient
          initialLat={initialView.lat}
          initialLon={initialView.lon}
          initialZoom={initialView.zoom}
          selectedFamilies={selectedFamilies}
          totalFamilies={FAMILIES.length}
          selectedCriteria={selectedCriteria}
          autoUpdate={autoUpdate}
          onVenuesChange={setVisibleCount}
          onZoomChange={setCurrentZoom}
          onVenuesData={handleVenuesData}
          flyTarget={flyTarget}
          initialVenues={effectiveInitialVenues}
          showFamilyLegend={selectedFamilies.size >= 2}
        />
      </div>

      {/* Overlay picker explore (#132). Rendu en dernier pour passer au-dessus
          de tous les contrôles (sidebar, view toggle, etc.). */}
      {pickerOpen && (
        <ExplorePicker
          initialFamilies={selectedFamilies}
          onSubmit={handlePickerSubmit}
          // onClose dispo uniquement après le 1er submit (pickerSeen=true),
          // sinon on force le choix au 1er visit (sans bouton ✕/Annuler).
          onClose={pickerSeen ? () => setPickerOpen(false) : undefined}
        />
      )}
    </div>
  );
}
