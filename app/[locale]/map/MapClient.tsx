"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Map,
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "react-map-gl/maplibre";
import Supercluster from "supercluster";
import type { ClusterFeature, PointFeature } from "supercluster";
import { Search, Star } from "lucide-react";
import type { VenuePin, ClubPin } from "@/lib/supabase/types";
import { getFamilyColor, getFamilyEmoji, FAMILIES } from "@/lib/families";
import ClubMarker from "@/components/map/ClubMarker";
import { saveViewport } from "@/lib/map-storage";
import {
  appleMapsUrl,
  googleMapsUrl,
  wazeUrl,
  whatsappShareUrl,
} from "@/lib/utils";

const FAVORITES_KEY = "sporthub-favorites";

/**
 * Familles pour lesquelles le mode clubs (zoom 10-15) n'a pas de sens :
 * pas de structure "club" avec plusieurs courts regroupés.
 * Ces familles restent en vue pois individuels même à zoom 10-15.
 */
const CLUB_INCOMPATIBLE_FAMILIES = new Set([
  "ballon",
  "boules",
  "nautique",
  "plus",
  "snow",
  "retraites",
]);

/**
 * Plage de zoom pour la vue clubs (1 pin/établissement).
 * En-dessous → agrégats pays/grid (PR #178). Au-dessus → pois individuels.
 */
const CLUB_ZOOM_MIN = 10;
const CLUB_ZOOM_MAX = 15;

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistFavorites(favs: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {
    /* localStorage plein/privé → silent */
  }
}

type Bounds = [number, number, number, number]; // [west, south, east, north]
type PointProps = { venue: VenuePin };

// IMPORTANT : `mapStyle` doit être une référence STABLE entre les renders
// React, sinon react-map-gl appelle `map.setStyle()` à chaque render → MapLibre
// rebuild le style en boucle (warning "Unable to perform style diff: Style is
// not done loading.. Rebuilding the style from scratch") → le canvas n'a jamais
// le temps de peindre et reste blanc (cf. issue #100).
//
// Sortir en constante module-level garantit l'identité de référence. Le style
// est statique pour SportHub — tile source unique, pas de switch dark/light.
const MAP_STYLE = {
  version: 8 as const,
  sources: {
    // CartoCDN "Voyager" — CDN global rapide (vs tile.openstreetmap.org
    // qui est lent, capacity-policy 1 req/s/IP, et HTTP/1.1).
    // Carto fournit ces tiles publiques gratuites pour usage modéré.
    // Subdomains a-d permettent au navigateur de paralléliser jusqu'à 4×.
    basemap: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: "basemap-layer", type: "raster" as const, source: "basemap" },
  ],
};

// Idem pour le style CSS du <Map> : référence stable.
const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

export type FlyTarget = {
  lat: number;
  lon: number;
  zoom?: number;
  /** Token (timestamp) qui change à chaque demande, re-déclenche l'effet
   * même si le user clique 2× la même suggestion (sinon le state inchangé
   * ne re-trigger pas le useEffect). */
  token: number;
};

type Props = {
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  /** Familles cochées. Si toutes ou vide, on n'envoie pas le param families au backend. */
  selectedFamilies?: Set<string>;
  totalFamilies?: number;
  /** Callback pour reporter le count de venues fetched (overlay UI parent). */
  onVenuesChange?: (count: number) => void;
  /** Callback pour reporter le zoom courant (overlay empty state intelligent, #125). */
  onZoomChange?: (zoom: number) => void;
  /** Callback pour reporter la liste des venues + centre courant — utilisé par
   * VenueListPanel (#123) pour partager la source data sans re-fetch. */
  onVenuesData?: (venues: VenuePin[], center: { lat: number; lon: number }) => void;
  /** Quand set, MapClient appelle map.flyTo() à chaque changement de token. */
  flyTarget?: FlyTarget | null;
  /** Mode "venues fixes" : si fourni, MapClient utilise ces venues directement
   * et skip l'API bbox-aware fetch. Utile pour /sports/[sport] qui veut
   * afficher seulement la page courante. */
  presetVenues?: VenuePin[];
  /** Filtre sport pour le bbox-aware fetch. Quand set, appelle /api/venues?sport=... */
  selectedSport?: string | null;
  /** Venues SSR pré-fetched (bbox d'initialisation). Affichés immédiatement
   * pour améliorer le LCP, avant que le premier bbox-aware fetch client retourne. */
  initialVenues?: VenuePin[];
  /** Critères universels cochés (lit / indoor / wheelchair / free / paid).
   * Envoyés à /api/venues?feat=... — AND entre critères côté DB. */
  selectedCriteria?: Set<string>;
  /** Surfaces cochées (clay / concrete / synthetic / grass / parquet / sand).
   * Envoyées à /api/venues?surface=... — filtre EXISTS sur venue_sport (#99). */
  selectedSurfaces?: Set<string>;
  /** Quand true (défaut), MapClient re-fetch automatiquement à chaque pan/zoom.
   * Quand false, le pan/zoom ne déclenche pas de fetch — un bouton "Rechercher
   * dans cette zone" apparaît à la place, et c'est le user qui décide quand
   * recharger. Cf. #124. */
  autoUpdate?: boolean;
};

export default function MapClient({
  initialLat,
  initialLon,
  initialZoom,
  selectedFamilies,
  totalFamilies,
  onVenuesChange,
  onZoomChange,
  onVenuesData,
  flyTarget,
  presetVenues,
  selectedSport,
  initialVenues,
  selectedCriteria,
  selectedSurfaces,
  autoUpdate = true,
}: Props) {
  const tMap = useTranslations("map");
  const mapRef = useRef<MapRef | null>(null);
  const [fetchedVenues, setFetchedVenues] = useState<VenuePin[]>(
    () => initialVenues ?? [],
  );
  const venues = presetVenues ?? fetchedVenues;
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [zoom, setZoom] = useState<number>(initialZoom);
  // Centre courant — exposé via onVenuesData pour permettre au VenueListPanel
  // (#123) de trier les venues par distance (Haversine).
  const [center, setCenter] = useState<{ lat: number; lon: number }>({
    lat: initialLat,
    lon: initialLon,
  });
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // Clubs fetchés depuis /api/venues/clubs (zoom 10-15, familles compatibles).
  const [clubs, setClubs] = useState<ClubPin[]>([]);
  // Clé "filtres + bounds" du dernier fetch réussi. Permet de détecter si
  // l'utilisateur a pané/zoomé depuis (afficher "Rechercher dans cette zone").
  const lastFetchedKeyRef = useRef<string | null>(null);
  // Token incrémenté quand l'utilisateur clique sur "Rechercher dans cette zone".
  // Stocké en state pour déclencher le re-run du useEffect, comparé via ref
  // pour savoir si "ce tour-ci" est dû à un user-force.
  const [forceFetchToken, setForceFetchToken] = useState(0);
  const prevForceFetchTokenRef = useRef(0);
  // Clé du dernier fetch clubs réussi (évite les re-fetches identiques).
  const lastFetchedClubsKeyRef = useRef<string | null>(null);

  // Mode clubs actif : zoom 10-15 ET la sélection se limite à des familles
  // qui supportent les clubs. Le mode club masque les pois individuels — on
  // ne l'active donc que si TOUTES les familles cochées sont compatibles.
  // Sinon (aucun filtre = toutes familles, ou sélection mixte incluant
  // ballon/boules/nautique/snow/retraites/plus), on garde les pois : sans ça
  // les venues des familles sans clustering disparaîtraient (pas de club
  // parent + pois masqués). L'affichage simultané clubs + pois isolés est
  // prévu palier 4 (#130).
  const isClubMode = useMemo(() => {
    if (zoom < CLUB_ZOOM_MIN || zoom > CLUB_ZOOM_MAX) return false;
    if (!selectedFamilies || selectedFamilies.size === 0) return false;
    for (const fam of selectedFamilies) {
      if (CLUB_INCOMPATIBLE_FAMILIES.has(fam)) return false;
    }
    return true;
  }, [zoom, selectedFamilies]);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Reporte le count initial (SSR pre-fetch) au parent pour l'overlay UI.
  useEffect(() => {
    if (initialVenues && initialVenues.length > 0) {
      onVenuesChange?.(initialVenues.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to target quand le token change (clic suggestion SearchBar).
  // On dépend des champs scalaires (token, lat, lon, zoom) et PAS de l'objet
  // flyTarget complet : un re-render sans changement de coordonnées ne doit
  // pas re-trigger un flyTo (sinon la carte saccade à chaque setState parent).
  useEffect(() => {
    if (!flyTarget) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.flyTo({
      center: [flyTarget.lon, flyTarget.lat],
      zoom: flyTarget.zoom ?? 12,
      duration: 800,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget?.token, flyTarget?.lat, flyTarget?.lon, flyTarget?.zoom]);

  // Fetch clubs debounced quand isClubMode est actif et bbox/filtres changent.
  // Quand isClubMode passe à false, on vide les clubs (pas de pins orphelins).
  useEffect(() => {
    if (!isClubMode || !bounds || presetVenues) {
      setClubs([]);
      return;
    }
    const famKey =
      selectedFamilies && totalFamilies &&
      selectedFamilies.size > 0 && selectedFamilies.size < totalFamilies
        ? Array.from(selectedFamilies).sort().join(",")
        : "";
    const currentKey = `clubs|${bounds.join(",")}|${famKey}`;
    if (currentKey === lastFetchedClubsKeyRef.current) return;

    const handle = setTimeout(async () => {
      const params = new URLSearchParams({ bbox: bounds.join(",") });
      if (famKey) {
        // Filtrer uniquement les familles compatibles (exclure les incompatibles)
        const compatFamilies = selectedFamilies
          ? Array.from(selectedFamilies).filter(
              (f) => !CLUB_INCOMPATIBLE_FAMILIES.has(f),
            )
          : [];
        if (compatFamilies.length > 0) {
          params.set("families", compatFamilies.join(","));
        }
      }
      try {
        const res = await fetch(`/api/venues/clubs?${params}`);
        if (!res.ok) {
          setClubs([]);
          return;
        }
        const data = (await res.json()) as { clubs: ClubPin[] };
        setClubs(data.clubs);
        lastFetchedClubsKeyRef.current = currentKey;
      } catch {
        setClubs([]);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [isClubMode, bounds, selectedFamilies, totalFamilies, presetVenues]);

  // Clés normalisées pour comparer "ce qui changerait le résultat".
  // On les sépare pour distinguer "filtres ont changé" vs "uniquement bbox".
  // Filtres → toujours re-fetch (intent utilisateur explicite).
  // Bbox seul → re-fetch SEULEMENT si autoUpdate=true OU si forceFetchToken bouge.
  const filtersKey = useMemo(() => {
    const fam =
      selectedFamilies &&
      totalFamilies &&
      selectedFamilies.size > 0 &&
      selectedFamilies.size < totalFamilies
        ? Array.from(selectedFamilies).sort().join(",")
        : "";
    const crit =
      selectedCriteria && selectedCriteria.size > 0
        ? Array.from(selectedCriteria).sort().join(",")
        : "";
    const surf =
      selectedSurfaces && selectedSurfaces.size > 0
        ? Array.from(selectedSurfaces).sort().join(",")
        : "";
    return `${fam}|${selectedSport || ""}|${crit}|${surf}`;
  }, [selectedFamilies, totalFamilies, selectedSport, selectedCriteria, selectedSurfaces]);

  const boundsKey = useMemo(() => (bounds ? bounds.join(",") : ""), [bounds]);

  // Fetch venues debounced quand bbox ou filtres changent.
  // Skip si on est en mode presetVenues (venues fixes passées en prop).
  useEffect(() => {
    if (presetVenues) {
      onVenuesChange?.(presetVenues.length);
      return;
    }
    if (!bounds) return;
    const currentKey = `${boundsKey}|${filtersKey}`;
    if (currentKey === lastFetchedKeyRef.current) return;
    // Détecte si l'effect tourne suite à un user-click "Rechercher dans cette
    // zone" (forceFetchToken a bougé). Si oui, on bypass le gate autoUpdate.
    const userForcedFetch =
      forceFetchToken !== prevForceFetchTokenRef.current;
    prevForceFetchTokenRef.current = forceFetchToken;
    // Si autoUpdate=off ET pas un force user ET que SEUL le bbox a bougé
    // (filtres identiques au dernier fetch), on n'auto-fetch pas. L'user
    // déclenchera via "Rechercher dans cette zone".
    if (!autoUpdate && !userForcedFetch) {
      const last = lastFetchedKeyRef.current;
      const lastFiltersKey = last ? last.split("|").slice(1).join("|") : null;
      if (lastFiltersKey !== null && lastFiltersKey === filtersKey) {
        return;
      }
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const params = new URLSearchParams({ bbox: bounds.join(",") });
      if (
        selectedFamilies &&
        totalFamilies &&
        selectedFamilies.size > 0 &&
        selectedFamilies.size < totalFamilies
      ) {
        params.set("families", Array.from(selectedFamilies).join(","));
      }
      if (selectedSport) {
        params.set("sport", selectedSport);
      }
      if (selectedCriteria && selectedCriteria.size > 0) {
        params.set("feat", Array.from(selectedCriteria).join(","));
      }
      if (selectedSurfaces && selectedSurfaces.size > 0) {
        params.set("surface", Array.from(selectedSurfaces).join(","));
      }
      try {
        const res = await fetch(`/api/venues?${params}`);
        if (!res.ok) {
          setFetchedVenues([]);
          onVenuesChange?.(0);
          return;
        }
        const data = (await res.json()) as { venues: VenuePin[] };
        setFetchedVenues(data.venues);
        onVenuesChange?.(data.venues.length);
        lastFetchedKeyRef.current = currentKey;
      } catch {
        setFetchedVenues([]);
        onVenuesChange?.(0);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [
    boundsKey,
    filtersKey,
    bounds,
    selectedFamilies,
    totalFamilies,
    onVenuesChange,
    presetVenues,
    selectedSport,
    selectedCriteria,
    selectedSurfaces,
    autoUpdate,
    forceFetchToken,
  ]);

  // Bouton "Rechercher dans cette zone" visible quand autoUpdate=false ET
  // le bbox/filtres actuels diffèrent du dernier fetch.
  const isStale = useMemo(() => {
    if (presetVenues) return false;
    if (!bounds) return false;
    if (autoUpdate) return false;
    const currentKey = `${boundsKey}|${filtersKey}`;
    return currentKey !== lastFetchedKeyRef.current;
  }, [presetVenues, bounds, autoUpdate, boundsKey, filtersKey]);

  const handleSearchThisArea = () => {
    setForceFetchToken((t) => t + 1);
  };

  // Supercluster index
  const supercluster = useMemo(() => {
    const sc = new Supercluster<PointProps>({ radius: 60, maxZoom: 16 });
    sc.load(
      venues.map((v) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        properties: { venue: v },
      })),
    );
    return sc;
  }, [venues]);

  const clusters = useMemo(() => {
    if (!bounds) return [];
    return supercluster.getClusters(bounds, Math.floor(zoom));
  }, [supercluster, bounds, zoom]);

  // Sync bounds + zoom à chaque interaction + persistance localStorage du
  // viewport (l'user retrouve sa dernière position au prochain /map).
  const updateViewport = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const b = map.getBounds();
    setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    const newZoom = map.getZoom();
    setZoom(newZoom);
    onZoomChange?.(newZoom);
    const c = map.getCenter();
    setCenter({ lat: c.lat, lon: c.lng });
    saveViewport({ lat: c.lat, lon: c.lng, zoom: newZoom });
  };

  // Reporte au parent (#123 VenueListPanel) la liste de venues + le centre
  // courant à chaque update — sans re-fetch propre côté liste.
  useEffect(() => {
    onVenuesData?.(venues, center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, center.lat, center.lon]);

  // Force le premier render MapLibre après le mount.
  //
  // Bug observé : MapClient est dynamic-imported (next/dynamic, ssr:false), donc
  // monté APRÈS l'hydration. À ce moment-là, le container peut avoir une taille
  // transitoire (CSS layout pas encore stabilisé), et MapLibre s'initialise avec
  // les mauvaises dimensions. Son ResizeObserver ne re-trigger pas toujours un
  // repaint quand le container atteint sa taille finale. Résultat : style chargé,
  // tiles chargées, mais canvas WebGL jamais peint → carte blanche (cf. #100).
  //
  // Le fix : au onLoad, on force resize() + triggerRepaint() pour s'assurer
  // que le 1er frame est dessiné avec les bonnes dimensions.
  const handleLoad = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.resize();
    map.triggerRepaint();
    updateViewport();
  };

  // Empty filter (l'user a tout décoché) — pas la peine de fetch
  const emptyFilter =
    selectedFamilies !== undefined && selectedFamilies.size === 0;

  return (
    <div className="relative h-full w-full">
      {/* Bouton "Rechercher dans cette zone" — visible quand autoUpdate=off
          ET le bbox courant diffère du dernier fetch. Pattern Airbnb/Google Maps. */}
      {isStale && !loading && (
        <button
          type="button"
          onClick={handleSearchThisArea}
          className="pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur transition hover:bg-accent"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {tMap("searchInThisArea")}
        </button>
      )}

    <Map
      ref={mapRef}
      initialViewState={{
        latitude: initialLat,
        longitude: initialLon,
        zoom: initialZoom,
      }}
      style={MAP_CONTAINER_STYLE}
      mapStyle={MAP_STYLE}
      onLoad={handleLoad}
      onMoveEnd={updateViewport}
    >
      <NavigationControl position="top-right" />

      {/* Pois individuels / supercluster — masqués en mode clubs (zoom 10-15
          avec familles compatibles) pour éviter le double affichage. */}
      {!emptyFilter && !isClubMode &&
        clusters.map((feature) => {
          const [lon, lat] = feature.geometry.coordinates;

          // Cluster bubble (count)
          if ("cluster" in feature.properties && feature.properties.cluster) {
            const cf = feature as ClusterFeature<PointProps>;
            const count = cf.properties.point_count;
            const size = Math.min(60, 20 + Math.log2(count) * 8);
            return (
              <Marker
                key={`cluster-${cf.id}`}
                latitude={lat}
                longitude={lon}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  const expansionZoom = Math.min(
                    supercluster.getClusterExpansionZoom(Number(cf.id)),
                    18,
                  );
                  mapRef.current?.getMap().flyTo({
                    center: [lon, lat],
                    zoom: expansionZoom,
                    duration: 500,
                  });
                }}
              >
                <button
                  type="button"
                  aria-label={`${count} spots — zoomer`}
                  className="flex cursor-pointer items-center justify-center rounded-full border-2 border-white bg-primary/90 font-semibold text-white shadow-md transition-transform hover:scale-110"
                  style={{ width: size, height: size, fontSize: size > 36 ? 14 : 12 }}
                >
                  {count}
                </button>
              </Marker>
            );
          }

          // Pin individuel
          const pf = feature as PointFeature<PointProps>;
          const v = pf.properties.venue;
          return (
            <Marker
              key={v.id}
              latitude={lat}
              longitude={lon}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelected(v);
              }}
            >
              <button
                type="button"
                aria-label={v.name}
                title={v.name}
                className="block h-3 w-3 cursor-pointer rounded-full border-2 border-white shadow-md transition-transform hover:scale-150"
                style={{ backgroundColor: getFamilyColor(v.family_slug) }}
              />
            </Marker>
          );
        })}

      {/* Mode clubs : zoom 10-15, familles compatibles. 1 pin/établissement.
          Click → zoom +3 pour révéler les pois individuels.
          Note : ClubMarker appelle e.stopPropagation() → le onClick du Marker
          react-map-gl ne se déclenche pas. On passe uniquement onClick à ClubMarker. */}
      {isClubMode && !emptyFilter &&
        clubs.map((club) => (
          <Marker
            key={`club-${club.id}`}
            latitude={club.lat}
            longitude={club.lon}
            anchor="center"
          >
            <ClubMarker
              club={club}
              onClick={() => {
                mapRef.current?.getMap().flyTo({
                  center: [club.lon, club.lat],
                  zoom: Math.min(zoom + 3, 18),
                  duration: 600,
                });
              }}
            />
          </Marker>
        ))}

      {loading && (
        <div className="pointer-events-none absolute right-4 top-20 z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          chargement…
        </div>
      )}

      {selected && (() => {
        // Famille pour le chip + CTA stylés (couleur de marque par famille).
        // Cf. #126 — popup pin enrichie : chip family + CTA "Voir la fiche".
        const family = FAMILIES.find((f) => f.slug === selected.family_slug);
        const familyColor = family?.color ?? "#6b7280";
        const familyLabel = family?.name_fr ?? selected.family_slug;
        const isFav = favorites.has(selected.slug);
        return (
          <Popup
            latitude={selected.lat}
            longitude={selected.lon}
            anchor="bottom"
            onClose={() => setSelected(null)}
            closeButton
            closeOnClick={false}
            offset={12}
            maxWidth="320px"
          >
            <div className="min-w-[260px] max-w-[300px] space-y-2.5 p-1 text-sm">
              {/* Header : chip famille (gauche) + étoile favori (droite) */}
              <div className="flex items-start justify-between gap-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                  style={{ backgroundColor: familyColor }}
                >
                  <span aria-hidden="true">{getFamilyEmoji(selected.family_slug)}</span>
                  {familyLabel}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFavorites((prev) => {
                      const next = new Set(prev);
                      if (next.has(selected.slug)) next.delete(selected.slug);
                      else next.add(selected.slug);
                      persistFavorites(next);
                      return next;
                    })
                  }
                  aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
                  aria-pressed={isFav}
                  className="-mt-0.5 -mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-yellow-500"
                >
                  <Star
                    className="h-5 w-5"
                    fill={isFav ? "currentColor" : "none"}
                    color={isFav ? "#eab308" : "currentColor"}
                  />
                </button>
              </div>

              {/* Titre venue + sport primaire si présent */}
              <div className="space-y-0.5">
                <h3 className="text-[15px] font-semibold leading-tight text-gray-900">
                  {selected.name}
                </h3>
                {selected.primary_sport_slug && (
                  <p className="text-xs capitalize text-gray-500">
                    {selected.primary_sport_slug.replaceAll("_", " ")}
                  </p>
                )}
              </div>

              {/* TODO #126 : afficher count courts ("🎾 12 courts") quand l'API
                  /api/venues exposera `courts_count` dans le payload VenuePin.
                  Dépendant de #113 (refacto payload) ou ajout direct au RPC. */}

              {/* Actions Itinéraire / Partager — tap targets ≥ 36px hauteur */}
              <div className="flex flex-wrap gap-1">
                <a
                  href={googleMapsUrl(selected.lat, selected.lon, selected.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span aria-hidden="true">📍</span> Google
                </a>
                <a
                  href={appleMapsUrl(selected.lat, selected.lon, selected.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span aria-hidden="true">🗺️</span> Apple
                </a>
                <a
                  href={wazeUrl(selected.lat, selected.lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span aria-hidden="true">🚗</span> Waze
                </a>
                <a
                  href={whatsappShareUrl(
                    selected.name,
                    `https://sporthubmap.com/venue/${selected.slug}`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span aria-hidden="true">💬</span> WhatsApp
                </a>
              </div>

              {/* CTA "Voir la fiche complète" — full width, couleur famille */}
              <Link
                href={`/venue/${selected.slug}`}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ backgroundColor: familyColor }}
              >
                Voir la fiche complète <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Popup>
        );
      })()}
    </Map>
    </div>
  );
}
