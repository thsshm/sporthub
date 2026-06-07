"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Crosshair, Share2, SlidersHorizontal, X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import {
  SportFilters,
  type CriteriaKey,
  type SurfaceKey,
} from "@/app/[locale]/map/SportFilters";
import { EmptyStateOverlay } from "@/app/[locale]/map/EmptyStateOverlay";
import { ViewModeToggle } from "@/app/[locale]/map/ViewModeToggle";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { MapBottomSheet, type SheetSnap } from "@/app/[locale]/map/MapBottomSheet";
import { ExplorePicker, type PickerSelection } from "@/app/[locale]/map/ExplorePicker";
import { MapLegend } from "@/app/[locale]/map/MapLegend";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";
import { publicEnv } from "@/lib/env";
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
import type { FacetCounts } from "@/lib/facets";

/** Breakpoint en dessous duquel "split" retombe en "map" (le panneau liste
 * passerait sinon par-dessus la carte sur étroit). Matche le min desktop V1. */
const SPLIT_MIN_PX = 1100;

/** Flag localStorage "le picker explore a déjà été vu". Une fois posé, on ne
 * re-prompt jamais le picker initial sur /map sans filtre (#132). */
const PICKER_SEEN_KEY = "sporthub_picker_seen";

function markPickerSeen() {
  try {
    window.localStorage.setItem(PICKER_SEEN_KEY, "1");
  } catch {
    /* localStorage plein/privé → silent (le picker pourra réapparaître) */
  }
}

/** Flag localStorage "on a déjà proposé la géoloc auto au 1er chargement".
 * Posé après toute tentative (succès comme refus) → jamais de re-prompt auto
 * aux visites suivantes. L'utilisateur garde le bouton "Ma position". #214. */
const GEO_PROMPTED_KEY = "sporthub_geo_prompted";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20">
      <div className="flex items-center gap-2 rounded-md bg-background/95 px-4 py-2 text-sm text-muted-foreground shadow-md backdrop-blur">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  /** Familles passées via ?family=X[,Y,…] (slugs déjà validés côté Server par
   * page.tsx). 1 slug = mode famille, plusieurs = mode explore. Cf. #121/#132. */
  initialFamilies?: string[] | null;
  /** Mode d'affichage initial (?view=X dans l'URL, lu côté Server). Cf. #123.
   * URL prioritaire sur localStorage si valide. */
  initialViewMode?: ViewMode | null;
  /** Ville passée via ?q=… (picker explore) : géocodée au mount → flyTo. #132. */
  initialQuery?: string | null;
  /** Coords résolues côté Server depuis ?city=<slug> (liens home "Villes à
   * explorer"). Si fourni, la carte s'ouvre centrée sur la ville (zoom 12, mode
   * POI → pins colorés par famille), prioritaire sur le viewport sauvegardé. */
  initialCityCenter?: { lat: number; lon: number } | null;
};

export function MapWithSearch({
  initialLat,
  initialLon,
  initialZoom,
  initialVenues,
  initialFamilies,
  initialViewMode,
  initialQuery,
  initialCityCenter,
}: Props) {
  const tMap = useTranslations("map");

  // Persistance viewport : si l'utilisateur revient sur /map, on restaure sa
  // dernière position (lazy init useState pour ne lire localStorage qu'une fois).
  // Si pas de viewport sauvé, on utilise les props passées par le Server (France).
  // NB: si viewport restauré ≠ initial Server, initialVenues (SSR pre-fetch
  // France) devient non pertinent → MapClient devra re-fetcher pour la nouvelle
  // zone. C'est OK : un seul roundtrip /api/venues.
  const [initialView] = useState(() => {
    // Deep-link ville (?city) → prioritaire sur le viewport sauvé : l'utilisateur
    // a explicitement cliqué une ville, on l'y emmène (zoom 12 = mode POI).
    // `restored: true` → on n'enverra pas les venues France SSR (non pertinentes).
    if (initialCityCenter) {
      return {
        lat: initialCityCenter.lat,
        lon: initialCityCenter.lon,
        zoom: 12,
        restored: true,
      };
    }
    // Deep-link viewport (?lat=&lon=&zoom=, #408) — lu AVANT le viewport sauvé
    // en localStorage. Le lien partagé exprime une intention explicite de position
    // → la carte MONTE directement sur ce viewport (initialViewState) plutôt que
    // d'y voler après le mount (flyTo post-mount = race avec mapRef non prêt).
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const pLat = parseFloat(params.get("lat") ?? "");
      const pLon = parseFloat(params.get("lon") ?? "");
      const pZoom = parseFloat(params.get("zoom") ?? "");
      if (
        Number.isFinite(pLat) && Number.isFinite(pLon) && Number.isFinite(pZoom) &&
        Math.abs(pLat) <= 90 && Math.abs(pLon) <= 180 && pZoom >= 0 && pZoom <= 24
      ) {
        return { lat: pLat, lon: pLon, zoom: pZoom, restored: true };
      }
    }
    const saved = loadViewport();
    if (saved) {
      return { lat: saved.lat, lon: saved.lon, zoom: saved.zoom, restored: true };
    }
    return { lat: initialLat, lon: initialLon, zoom: initialZoom, restored: false };
  });

  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);

  // Ref posée dès qu'une intention de position EXPLICITE recentre la carte
  // (recherche ville, clic liste, ville du picker, bouton "Ma position"). La
  // géoloc auto (#214) ne recentre QUE si cette ref est encore fausse — sinon
  // elle pourrait écraser un choix utilisateur résolu plus tôt (anti-race).
  const userMovedRef = useRef(false);
  const flyToUser = (t: FlyTarget) => {
    userMovedRef.current = true;
    setFlyTarget(t);
  };

  // Posée quand la géoloc NAVIGATEUR précise (#214) a recentré la carte. Le
  // recentrage IP (approximatif, ville) ne doit jamais écraser une position
  // précise déjà obtenue — priorité : action user > géoloc navigateur > IP.
  const precisePosRef = useRef(false);

  // ── Sync viewport → URL (#251 partage) ────────────────────────────────
  // À chaque moveend (via onViewportChange de MapClient), on met à jour
  // ?lat=&lon=&zoom= dans l'URL (history.replaceState, pas pushState → pas de
  // pollution de l'historique). Cela rend l'URL shareable : ouvrir le lien
  // rouvre la carte exactement sur le même viewport + les mêmes filtres.
  const syncViewportToUrl = (lat: number, lon: number, zoom: number) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("lat", lat.toFixed(5));
    params.set("lon", lon.toFixed(5));
    params.set("zoom", zoom.toFixed(1));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  // ── Partage de la vue carte (#251) ─────────────────────────────────────
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    const title = tMap("shareTitle");
    const text = tMap("shareText", { count: visibleCount });
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // Refusé par l'utilisateur ou non supporté → fallback clipboard
      }
    }
    // Fallback : copier le lien dans le presse-papier
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      /* clipboard indisponible (contexte non-sécurisé) → silencieux */
    }
  };

  // Init des familles depuis ?family=X[,Y,…] (slugs validés côté Server).
  // Aucun param → toutes les familles (mode explore complet).
  const router = useRouter();
  const pathname = usePathname();

  const [selectedFamilies, setSelectedFamilies] = useState<Set<string>>(() =>
    initialFamilies && initialFamilies.length > 0
      ? new Set(initialFamilies)
      : new Set(FAMILIES.map((f) => f.slug))
  );

  // ── Bottom sheet mobile (#256) ─────────────────────────────────────────
  // Snap point actif : peek (80px) / mid (45%) / full (92%). Initialisé
  // depuis ?sheet= dans l'URL (partage de vue, #251) ou peek par défaut.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>(() => {
    if (typeof window === "undefined") return "peek";
    const s = new URLSearchParams(window.location.search).get("sheet");
    return (s === "peek" || s === "mid" || s === "full") ? s : "peek";
  });

  // Sync snap → URL pour que le lien partagé (#251) rouvre le même snap.
  const handleSheetSnap = (snap: SheetSnap) => {
    setSheetSnap(snap);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("sheet", snap);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
  };

  // Picker explore (#132) : overlay multi-familles au 1er visit de /map sans
  // Le picker n'est plus ouvert automatiquement au mount (#257) : un utilisateur
  // qui arrive sur /map (via le CTA "Explore the map" de la home ou directement)
  // veut voir la carte immédiatement. Le picker bloquant avant la carte crée de
  // la friction inutile (cf. pattern Google Maps / AirBnb : carte d'abord,
  // filtres ensuite). Le picker reste accessible via le bouton "Changer ma
  // sélection" dans la sidebar (onReopenPicker, déjà câblé).
  const [pickerOpen, setPickerOpen] = useState(false);

  // Sync URL ↔ selectedFamilies (checkboxes/switcher) :
  //   - 0 ou TOUTES → URL propre (pas de ?family) = explore complet
  //   - sous-ensemble strict → ?family=slug1,slug2 (liste triée, stable)
  // router.replace (pas d'historique). On lit window.location pour préserver
  // les autres params (?q, ?view…) sans wrapper la page dans <Suspense>.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const size = selectedFamilies.size;
    if (size === 0 || size === FAMILIES.length) {
      if (params.has("family")) {
        params.delete("family");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    } else {
      const slugs = Array.from(selectedFamilies).sort().join(",");
      if (params.get("family") !== slugs) {
        params.set("family", slugs);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFamilies]);

  // Géocodage one-shot de ?q=ville au mount → flyTo (picker explore, #132).
  const didGeocodeRef = useRef(false);
  useEffect(() => {
    if (!initialQuery || didGeocodeRef.current) return;
    didGeocodeRef.current = true;
    (async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          initialQuery
        )}&limit=1&accept-language=fr`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const rows = (await res.json()) as { lat: string; lon: string }[];
        if (rows[0]) {
          setFlyTarget({
            lat: parseFloat(rows[0].lat),
            lon: parseFloat(rows[0].lon),
            zoom: 12,
            token: Date.now(),
          });
        }
      } catch {
        /* géocodage échoué → on reste sur la vue par défaut */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Restauration depuis un lien partagé (#251). Si l'URL contient ?lat=&lon=&zoom=
  // (mis à jour par syncViewportToUrl), on flyTo directement — prioritaire sur la
  // géoloc IP et la géoloc navigateur. Exécuté au mount uniquement (une fois).
  const didRestoreSharedRef = useRef(false);
  useEffect(() => {
    if (didRestoreSharedRef.current) return;
    didRestoreSharedRef.current = true;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("lat") ?? "");
    const lon = parseFloat(params.get("lon") ?? "");
    const zoom = parseFloat(params.get("zoom") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(zoom)
        && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      flyToUser({ lat, lon, zoom, token: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-géolocalisation au 1er chargement (#214). On propose la position du
  // navigateur et on recentre dessus, UNIQUEMENT pour un nouveau visiteur :
  //   - pas de viewport sauvé (sinon priorité à la dernière position connue)
  //   - pas de deep-link positionnel (?q / ?family / ?lat — intention explicite)
  //   - pas déjà prompté (flag localStorage) → on ne redemande jamais en auto
  // Refus / erreur / timeout → on reste sur la France (silencieux, fallback du
  // viewport Server). Le bouton "Ma position" reste dispo pour relancer.
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;
    if (initialView.restored || initialQuery) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("family") || params.has("lat") || params.has("city")) return;
    try {
      if (window.localStorage.getItem(GEO_PROMPTED_KEY) === "1") return;
    } catch {
      /* localStorage inaccessible → on tente une fois quand même */
    }
    const markPrompted = () => {
      try {
        window.localStorage.setItem(GEO_PROMPTED_KEY, "1");
      } catch {
        /* silent */
      }
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        markPrompted();
        // L'utilisateur a déjà choisi une position entre-temps → ne pas écraser.
        if (userMovedRef.current) return;
        precisePosRef.current = true; // position précise : prime sur la géoloc IP
        setFlyTarget({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          zoom: 11,
          token: Date.now(),
        });
      },
      () => markPrompted(),
      { timeout: 8000, maximumAge: 60_000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentrage approximatif par IP (#214 suite). Complète la géoloc navigateur :
  // dès le mount, on appelle /api/geo (géoloc edge Vercel, ~ville, SANS
  // permission) et on recentre instantanément sur la région du visiteur — au
  // lieu de la France entière. La géoloc navigateur, plus précise, raffine
  // ensuite (zoom 11) si l'utilisateur l'autorise.
  // Mêmes gardes que la géoloc navigateur : pas de viewport restauré, pas de
  // deep-link positionnel, pas de choix user déjà résolu. Échec / dev local
  // (headers absents) → silencieux, on garde la vue par défaut.
  useEffect(() => {
    if (initialView.restored || initialQuery) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("family") || params.has("lat")) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/geo");
        if (!res.ok) return;
        const { geo } = (await res.json()) as {
          geo: { lat: number; lon: number } | null;
        };
        // Une intention précise (user ou géoloc navigateur) est arrivée
        // entre-temps → ne pas écraser avec l'approximation IP.
        if (cancelled || !geo || userMovedRef.current || precisePosRef.current) return;
        setFlyTarget({ lat: geo.lat, lon: geo.lon, zoom: 10, token: Date.now() });
      } catch {
        /* /api/geo indispo (dev local) → on garde la vue par défaut */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedCriteria, setSelectedCriteria] = useState<Set<CriteriaKey>>(() => new Set());
  const [selectedSurfaces, setSelectedSurfaces] = useState<Set<SurfaceKey>>(() => new Set());
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(() => loadAutoUpdate(true));
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  // Compteurs à facettes par filtre (#279), alimentés par MapClient via
  // /api/venues/facets. null = pas de données (mode agrégats / erreur / timeout).
  const [facets, setFacets] = useState<FacetCounts | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);
  // Nombre de clubs affichés dans le viewport (mode club zoom 10-15). 0 sinon.
  // Alimente le compteur "N clubs" de l'overlay (palier 4, #311).
  const [clubsCount, setClubsCount] = useState(0);
  const [geolocError, setGeolocError] = useState<string | null>(null);

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
  const effectiveMode: ViewMode = viewMode === "split" && !isWideEnoughForSplit ? "map" : viewMode;

  // Snapshot venues + center reporté par MapClient pour alimenter
  // VenueListPanel sans re-fetch propre (#123).
  const [venuesSnapshot, setVenuesSnapshot] = useState<{
    venues: VenuePin[];
    center: { lat: number; lon: number };
  }>({ venues: [], center: { lat: initialLat, lon: initialLon } });

  const handleVenuesData = (venues: VenuePin[], center: { lat: number; lon: number }) => {
    setVenuesSnapshot({ venues, center });
  };

  const handleListVenueSelect = (v: VenuePin) => {
    flyToUser({ lat: v.lat, lon: v.lon, zoom: 14, token: Date.now() });
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
    [initialView.restored, initialVenues]
  );

  // Fallback client-side pour les compteurs famille (#279) : quand
  // /api/venues/facets timeout (facets = null), on calcule depuis venuesSnapshot
  // (les POI déjà chargés, ≤ 2000). Immédiat, sans requête DB supplémentaire.
  // Critères + surfaces restent undefined tant que la perf DB n'est pas réglée.
  const familyCounts = useMemo(() => {
    if (facets?.family) return facets.family;
    const counts: Record<string, number> = {};
    for (const v of venuesSnapshot.venues) {
      if (v.family_slug) counts[v.family_slug] = (counts[v.family_slug] ?? 0) + 1;
    }
    return Object.keys(counts).length > 0 ? counts : undefined;
  }, [facets, venuesSnapshot.venues]);

  // Bouton "Ma position" — demande la géolocalisation navigateur puis flyTo.
  const handleMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeolocError(tMap("myLocationUnavailable"));
      return;
    }
    setGeolocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyToUser({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          zoom: 12,
          token: Date.now(),
        });
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        setGeolocError(err.code === 1 ? tMap("myLocationDenied") : tMap("myLocationUnavailable"));
      },
      { timeout: 8000, maximumAge: 60_000 }
    );
  };

  // Validation du picker explore : applique la sélection, écrit l'URL
  // canonique (?family=…&q=…), recentre sur la ville, marque "vu". #132.
  const handlePickerSubmit = ({ families, city }: PickerSelection) => {
    markPickerSeen();
    setPickerOpen(false);
    setSelectedFamilies(new Set(families));

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (families.length > 0 && families.length < FAMILIES.length) {
        params.set("family", [...families].sort().join(","));
      } else {
        params.delete("family");
      }
      if (city) {
        // Token court de ville pour une URL propre ("Paris, …" → "paris").
        params.set("q", city.display_name.split(",")[0].trim().toLowerCase());
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }

    if (city) {
      flyToUser({ lat: city.lat, lon: city.lon, zoom: 12, token: Date.now() });
    }
  };

  const handleClosePicker = () => {
    markPickerSeen();
    setPickerOpen(false);
  };

  return (
    <div className="relative h-full w-full">
      {/* Sidebar desktop */}
      <SportFilters
        selected={selectedFamilies}
        onChange={setSelectedFamilies}
        selectedCriteria={selectedCriteria}
        onCriteriaChange={setSelectedCriteria}
        selectedSurfaces={selectedSurfaces}
        onSurfacesChange={setSelectedSurfaces}
        autoUpdate={autoUpdate}
        onAutoUpdateChange={setAutoUpdate}
        onReopenPicker={() => setPickerOpen(true)}
        familyCounts={familyCounts}
        criteriaCounts={facets?.criteria}
        surfaceCounts={facets?.surface}
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
                selectedSurfaces={selectedSurfaces}
                onSurfacesChange={setSelectedSurfaces}
                autoUpdate={autoUpdate}
                onAutoUpdateChange={setAutoUpdate}
                onReopenPicker={() => {
                  setMobileFiltersOpen(false);
                  setPickerOpen(true);
                }}
                familyCounts={familyCounts}
                criteriaCounts={facets?.criteria}
                surfaceCounts={facets?.surface}
                className="border-0 p-0 shadow-none"
              />
            </div>
          </div>
        </div>
      )}

      <SearchBar
        onSelect={(r) => flyToUser({ lat: r.lat, lon: r.lon, zoom: 12, token: Date.now() })}
        className="absolute right-4 top-4 z-20 w-[min(320px,calc(100vw-180px))] md:w-80"
      />

      {/* Bouton "Ma position" (géolocalisation navigateur) */}
      <button
        type="button"
        onClick={handleMyLocation}
        aria-label={tMap("myLocation")}
        title={tMap("myLocation")}
        className="bottom-safe-16 absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-md backdrop-blur hover:bg-accent"
      >
        <Crosshair className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Bouton "Partager" — navigator.share natif sur mobile, copie URL sur
          desktop. Sync viewport → URL dès qu'on interagit avec la carte, donc
          l'URL est toujours à jour quand on clique Partager. (#251) */}
      <button
        type="button"
        onClick={handleShare}
        aria-label={tMap("share")}
        title={tMap("share")}
        className="bottom-safe-28 absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-md backdrop-blur hover:bg-accent"
      >
        <Share2 className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Toast "Lien copié" (fallback desktop quand navigator.share absent) */}
      {shareCopied && (
        <div
          role="status"
          aria-live="polite"
          className="bottom-safe-44 absolute right-4 z-30 rounded-md bg-background/95 px-3 py-2 text-sm shadow-md backdrop-blur"
        >
          {tMap("linkCopied")}
        </div>
      )}

      {/* Toast erreur géolocalisation */}
      {geolocError && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-32 right-4 z-30 max-w-xs rounded-md border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
        >
          {geolocError}
        </div>
      )}

      <div className="bottom-safe-4 pointer-events-none absolute left-4 z-10 rounded-md bg-background/90 px-3 py-2 text-sm shadow-md backdrop-blur md:left-64">
        {clubsCount > 0
          ? tMap("clubsInView", { count: formatCount(clubsCount) })
          : tMap("spotsInView", { count: formatCount(visibleCount) })}
      </div>

      {/* Légende couleurs par famille — visible en mode explore (2+ familles
          actives), cachée quand une seule famille filtrée. Cf. #132. */}
      {selectedFamilies.size >= 2 && (
        <div className="bottom-safe-16 pointer-events-none absolute left-1/2 z-20 -translate-x-1/2">
          <MapLegend activeSlugs={Array.from(selectedFamilies).sort()} />
        </div>
      )}

      {/* Empty state intelligent (#125) : overlay centré quand 0 spots dans la
          vue, avec message contextuel (zoom trop bas/haut, filtres restrictifs,
          fallback générique). Pas affiché en mode presetVenues. */}
      <EmptyStateOverlay
        count={visibleCount}
        zoom={currentZoom}
        selectedFamilies={selectedFamilies}
        totalFamilies={FAMILIES.length}
        selectedCriteria={selectedCriteria}
        hasTiles={Boolean(publicEnv.tilesUrl)}
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
          selectedSurfaces={selectedSurfaces}
          autoUpdate={autoUpdate}
          onVenuesChange={setVisibleCount}
          onClubsChange={setClubsCount}
          onZoomChange={setCurrentZoom}
          onViewportChange={syncViewportToUrl}
          onVenuesData={handleVenuesData}
          onFacetsChange={setFacets}
          flyTarget={flyTarget}
          initialVenues={effectiveInitialVenues}
        />
      </div>

      {/* Bottom sheet mobile (#256) — visible uniquement sur mobile (md:hidden
          dans le composant). Monté quand la sidebar desktop n'est pas visible,
          i.e. toujours sur mobile (split dégrade en map, pas de panel droit). */}
      {!isWideEnoughForSplit && (
        <MapBottomSheet
          venues={venuesSnapshot.venues}
          center={venuesSnapshot.center}
          visibleCount={visibleCount}
          snap={sheetSnap}
          onSnapChange={handleSheetSnap}
          onSelect={handleListVenueSelect}
        />
      )}

      {/* Picker explore (#132) : overlay multi-familles + ville. Au-dessus de
          tout (z-40). Monté seulement quand ouvert. */}
      {pickerOpen && (
        <ExplorePicker
          initialFamilies={Array.from(selectedFamilies)}
          onSubmit={handlePickerSubmit}
          onClose={handleClosePicker}
        />
      )}
    </div>
  );
}
