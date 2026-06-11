"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Map, Marker, NavigationControl, Popup, type MapRef } from "react-map-gl/maplibre";
import Supercluster from "supercluster";
import type { ClusterFeature, PointFeature } from "supercluster";
import { Search, Star } from "lucide-react";
import type { VenuePin, ClubPin } from "@/lib/supabase/types";
import type { FacetCounts } from "@/lib/facets";
import { getFamilyColor, getFamilyEmoji, FAMILIES } from "@/lib/families";
import { getSportEmoji } from "@/lib/sports";
import ClubMarker from "@/components/map/ClubMarker";
import VenueTilesLayer from "./VenueTilesLayer";
import { publicEnv } from "@/lib/env";
import { saveViewport } from "@/lib/map-storage";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { VenuePopupEnrichments } from "@/components/map/VenuePopupEnrichments";
import { appleMapsUrl, googleMapsUrl, wazeUrl, whatsappShareUrl } from "@/lib/utils";

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
/** Propriétés agrégées par cluster (Supercluster map/reduce) : compte de venues
 * par famille → permet de colorer la bulle de cluster par famille dominante. */
type ClusterProps = { fams: Record<string, number> };

/** Cellule d'agrégat retournée par l'API (cf. #114). */
type AggregateCell = {
  lat: number;
  lon: number;
  count: number;
  country_code: string | null;
};

/** Réponse discriminée /api/venues — `mode` choisit la branche de rendu.
 *  Sans `zoom` query param, l'API retourne `mode: 'pois'` (rétro-compat). */
type VenuesApiResponse =
  | { mode: "pois"; venues: VenuePin[]; count: number }
  | { mode: "aggregates"; cells: AggregateCell[]; count: number };

/** Seuil de bascule POI ↔ agrégats (doit matcher app/api/venues/route.ts). */
const ZOOM_POI_THRESHOLD = 10;
/** Délai de débounce sur moveend/zoomend (cf. #114 — 200ms pattern Mapbox/Airbnb). */
const MOVE_DEBOUNCE_MS = 200;
/** Durée de la transition fade entre agrégats et POI au swap zoom 9↔10. */
const FADE_TRANSITION_MS = 200;
/** Boost de zoom au clic sur une bulle d'agrégat (passe sous le seuil POI). */
const AGGREGATE_CLICK_ZOOM_BOOST = 3;

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
  layers: [{ id: "basemap-layer", type: "raster" as const, source: "basemap" }],
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
  /** Callback pour reporter le viewport courant (lat/lon/zoom) après chaque
   * moveend — utilisé par MapWithSearch pour sync l'URL (#251 partage). */
  onViewportChange?: (lat: number, lon: number, zoom: number) => void;
  /** Callback pour reporter la liste des venues + centre courant — utilisé par
   * VenueListPanel (#123) pour partager la source data sans re-fetch. */
  onVenuesData?: (venues: VenuePin[], center: { lat: number; lon: number }) => void;
  /** Callback pour reporter les compteurs à facettes du viewport — alimente les
   * compteurs par filtre du panneau gauche (#279). null = pas de données
   * (mode agrégats / erreur). */
  onFacetsChange?: (facets: FacetCounts | null) => void;
  /** Callback pour reporter le nombre de clubs affichés dans le viewport
   * (mode club, zoom 10-15). 0 hors mode club. Alimente le compteur sidebar
   * "N clubs" (palier 4, #311). */
  onClubsChange?: (count: number) => void;
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
  /** Position GPS de l'utilisateur → affiche un point bleu "vous êtes ici"
   * (orientation). Renseignée par la géoloc navigateur (bouton Ma position /
   * auto-géoloc au mount). null = pas de position connue. */
  userLocation?: { lat: number; lon: number } | null;
};

export default function MapClient({
  initialLat,
  initialLon,
  initialZoom,
  selectedFamilies,
  totalFamilies,
  onVenuesChange,
  onZoomChange,
  onViewportChange,
  onVenuesData,
  onFacetsChange,
  onClubsChange,
  flyTarget,
  presetVenues,
  selectedSport,
  initialVenues,
  selectedCriteria,
  selectedSurfaces,
  autoUpdate = true,
  userLocation,
}: Props) {
  const tMap = useTranslations("map");
  // Noms de sports localisés pour la popup (#476) : sans ça le slug brut anglais
  // (« table tennis », « yoga retreat ») s'affichait quelle que soit la langue.
  const tSports = useTranslations("sports");
  const mapRef = useRef<MapRef | null>(null);
  // Vector tiles (#226) : quand NEXT_PUBLIC_TILES_URL est défini, on rend les
  // venues via tuiles PMTiles (coût O(1)) au lieu de fetch /api/venues +
  // Supercluster. Inactif sur les pages presetVenues (sport) qui passent leurs
  // propres venues. Flag absent → comportement carte inchangé.
  //
  // Inactif aussi quand un sport unique est sélectionné (page /sports/[sport] ou
  // filtre mono-sport sur /map) : les tuiles PMTiles ne portent qu'un filtre
  // FAMILLE (cf. venueTilesFilter), pas le sport — les afficher montrerait tous
  // les sports de la famille. On bascule alors sur le fetch /api/venues?sport=…
  // qui filtre par sport côté DB (POI à zoom ≥ 10, agrégats venues_aggregates à
  // zoom < 10). Sans ce garde, selectedSport était silencieusement ignoré.
  const useTiles = Boolean(publicEnv.tilesUrl) && !presetVenues && !selectedSport;
  const [fetchedVenues, setFetchedVenues] = useState<VenuePin[]>(() => initialVenues ?? []);
  // Cellules d'agrégat retournées quand zoom < 10 (#114). Vide en mode POI.
  // En mode presetVenues, jamais utilisé (la page passe les venues directement).
  const [aggregates, setAggregates] = useState<AggregateCell[]>([]);
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
  // Club sélectionné (clic sur un ClubMarker) → popup listant ses courts
  // (palier 4, #311). `clubVenues` = courts du club, lazy-fetchés.
  const [selectedClub, setSelectedClub] = useState<ClubPin | null>(null);
  const [clubVenues, setClubVenues] = useState<VenuePin[]>([]);
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
  // Mode club actif sur toute la plage zoom 10-15 (hors pages preset / tuiles).
  // On affiche désormais SIMULTANÉMENT les pins club (familles clusterisées) et
  // les pois isolés (venues sans club_id : familles non clusterisées + courts
  // isolés). Plus besoin de restreindre aux familles compatibles — rien ne
  // disparaît, le tri pois↔clubs se fait via `club_id` côté rendu (#311).
  const isClubMode = useMemo(() => {
    // selectedSport (page /sports/[sport]) : on désactive le mode club. La RPC
    // clubs (/api/venues/clubs) ne filtre QUE par `families`, jamais par sport →
    // en mode club la carte affichait des pins de clubs tous-sports par-dessus
    // les pois padel filtrés (« la liste est padel mais la carte non », #455).
    // Sans club mode, on rend tous les pois sport-filtrés (clubbed inclus, cf.
    // le filtre `club_id == null` ligne ~600 qui ne s'applique qu'en club mode).
    // Même garde que useTiles (#438) / presetVenues.
    if (presetVenues || useTiles || selectedSport) return false;
    return zoom >= CLUB_ZOOM_MIN && zoom <= CLUB_ZOOM_MAX;
  }, [zoom, presetVenues, useTiles, selectedSport]);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Lazy-fetch des courts du club sélectionné (popup vue club, #311).
  // Vide la liste tant qu'aucun club n'est ouvert.
  useEffect(() => {
    if (!selectedClub) {
      setClubVenues([]);
      return;
    }
    let cancelled = false;
    setClubVenues([]);
    fetch(`/api/venues/clubs/${selectedClub.id}`)
      .then((res) => (res.ok ? res.json() : { venues: [] }))
      .then((data: { venues?: VenuePin[] }) => {
        if (!cancelled) setClubVenues(data.venues ?? []);
      })
      .catch(() => {
        if (!cancelled) setClubVenues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClub]);

  // Reporte le nombre de clubs visibles au parent (compteur sidebar "N clubs",
  // palier 4 #311). En mode pois, `clubs` est vide → reporte 0.
  useEffect(() => {
    onClubsChange?.(clubs.length);
  }, [clubs, onClubsChange]);

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
    // En mode tuiles vectorielles (#226), pas de fetch clubs : le rendu vient
    // des tuiles. On vide pour ne pas laisser de pins clubs orphelins.
    if (!isClubMode || !bounds || presetVenues || useTiles) {
      setClubs([]);
      return;
    }
    const famKey =
      selectedFamilies &&
      totalFamilies &&
      selectedFamilies.size > 0 &&
      selectedFamilies.size < totalFamilies
        ? Array.from(selectedFamilies).sort().join(",")
        : "";
    const currentKey = `clubs|${bounds.join(",")}|${famKey}`;
    if (currentKey === lastFetchedClubsKeyRef.current) return;

    const handle = setTimeout(async () => {
      const params = new URLSearchParams({ bbox: bounds.join(",") });
      if (famKey) {
        // Filtrer uniquement les familles compatibles (exclure les incompatibles)
        const compatFamilies = selectedFamilies
          ? Array.from(selectedFamilies).filter((f) => !CLUB_INCOMPATIBLE_FAMILIES.has(f))
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
  }, [isClubMode, bounds, selectedFamilies, totalFamilies, presetVenues, useTiles]);

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

  // Tier de zoom (#114) : on n'envoie pas le zoom exact dans le param fetch —
  // on envoie un "bucket" (floor) pour que des zooms voisins (12.1, 12.4)
  // hittent la même clé de cache CDN. Au-dessus du seuil POI, peu importe la
  // valeur exacte tant qu'elle est ≥ seuil — on envoie le floor pour garder
  // un même cache hit. Le bucket sert aussi de clé dans le useEffect ci-dessous.
  const zoomBucket = useMemo(() => Math.floor(zoom), [zoom]);
  // Mode courant déduit du zoom — utilisé pour la transition fade UI et pour
  // décider de quoi rendre (POI vs bulles).
  const isAggregateMode = zoomBucket < ZOOM_POI_THRESHOLD;

  // Fetch venues/aggregates quand bbox, zoom-bucket ou filtres changent.
  // Skip si on est en mode presetVenues (venues fixes passées en prop).
  //
  // À noter : le débounce 200ms côté event MapLibre (#114) coalesce déjà la
  // rafale de moveend en un seul update du state `bounds`. On garde ici un
  // micro-délai (50ms) seulement pour absorber les changements simultanés
  // bounds+zoom dans le même cycle React → 1 seul fetch.
  useEffect(() => {
    if (presetVenues) {
      onVenuesChange?.(presetVenues.length);
      return;
    }
    // Mode tuiles vectorielles (#226) : le rendu vient des tuiles, pas de
    // bbox-aware fetch /api/venues. /api/venues reste pour la liste + recherche.
    if (useTiles) return;
    if (!bounds) return;
    const currentKey = `${boundsKey}|${filtersKey}|z${zoomBucket}`;
    if (currentKey === lastFetchedKeyRef.current) return;
    // Détecte si l'effect tourne suite à un user-click "Rechercher dans cette
    // zone" (forceFetchToken a bougé). Si oui, on bypass le gate autoUpdate.
    const userForcedFetch = forceFetchToken !== prevForceFetchTokenRef.current;
    prevForceFetchTokenRef.current = forceFetchToken;
    // Si autoUpdate=off ET pas un force user ET que SEUL le bbox/zoom a bougé
    // (filtres identiques au dernier fetch), on n'auto-fetch pas. L'user
    // déclenchera via "Rechercher dans cette zone".
    if (!autoUpdate && !userForcedFetch) {
      const last = lastFetchedKeyRef.current;
      const lastFiltersKey = last ? (last.split("|")[1] ?? null) : null;
      if (lastFiltersKey !== null && lastFiltersKey === filtersKey) {
        return;
      }
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const params = new URLSearchParams({ bbox: bounds.join(",") });
      params.set("zoom", String(zoomBucket));
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
          setAggregates([]);
          onVenuesChange?.(0);
          return;
        }
        const data = (await res.json()) as VenuesApiResponse;
        if (data.mode === "aggregates") {
          setAggregates(data.cells);
          // En mode agrégats on vide les POI pour ne pas garder du legacy à
          // l'écran sous les bulles. Le count remonté est celui des bulles
          // (le total venues n'est pas connu côté agrégats sans sommer).
          setFetchedVenues([]);
          const totalCount = data.cells.reduce((acc, c) => acc + c.count, 0);
          onVenuesChange?.(totalCount);
        } else {
          setFetchedVenues(data.venues);
          setAggregates([]);
          onVenuesChange?.(data.venues.length);
        }
        lastFetchedKeyRef.current = currentKey;
      } catch {
        setFetchedVenues([]);
        setAggregates([]);
        onVenuesChange?.(0);
      } finally {
        setLoading(false);
      }
    }, 50);
    return () => clearTimeout(handle);
  }, [
    boundsKey,
    filtersKey,
    zoomBucket,
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
    useTiles,
  ]);

  // Fetch des compteurs à facettes (#279) — effect séparé du fetch venues pour
  // ne pas alourdir ce dernier. Même clé bbox+filtres, debounce identique.
  // Actif uniquement en mode POI (zoom ≥ seuil) : à bas zoom les facettes
  // seraient énormes et le panneau de filtres n'est pas le focus. Skip aussi
  // en presetVenues (pages /sports sans panneau filtres). Respecte autoUpdate
  // comme le fetch venues.
  const lastFetchedFacetsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (presetVenues || !onFacetsChange) return;
    if (!bounds || isAggregateMode) {
      if (isAggregateMode) onFacetsChange(null);
      return;
    }
    if (!autoUpdate) return;
    const currentKey = `facets|${boundsKey}|${filtersKey}`;
    if (currentKey === lastFetchedFacetsKeyRef.current) return;
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
      if (selectedCriteria && selectedCriteria.size > 0) {
        params.set("feat", Array.from(selectedCriteria).join(","));
      }
      if (selectedSurfaces && selectedSurfaces.size > 0) {
        params.set("surface", Array.from(selectedSurfaces).join(","));
      }
      try {
        const res = await fetch(`/api/venues/facets?${params}`);
        if (!res.ok) {
          onFacetsChange(null);
          return;
        }
        const data = (await res.json()) as FacetCounts;
        onFacetsChange(data);
        lastFetchedFacetsKeyRef.current = currentKey;
      } catch {
        onFacetsChange(null);
      }
    }, 50);
    return () => clearTimeout(handle);
  }, [
    boundsKey,
    filtersKey,
    bounds,
    isAggregateMode,
    selectedFamilies,
    totalFamilies,
    selectedCriteria,
    selectedSurfaces,
    autoUpdate,
    presetVenues,
    onFacetsChange,
  ]);

  // Bouton "Rechercher dans cette zone" visible quand autoUpdate=false ET
  // le bbox/zoom/filtres actuels diffèrent du dernier fetch.
  const isStale = useMemo(() => {
    if (presetVenues) return false;
    if (!bounds) return false;
    if (autoUpdate) return false;
    const currentKey = `${boundsKey}|${filtersKey}|z${zoomBucket}`;
    return currentKey !== lastFetchedKeyRef.current;
  }, [presetVenues, bounds, autoUpdate, boundsKey, filtersKey, zoomBucket]);

  const handleSearchThisArea = () => {
    setForceFetchToken((t) => t + 1);
  };

  // Supercluster index
  const supercluster = useMemo(() => {
    const sc = new Supercluster<PointProps, ClusterProps>({
      // radius 40px (vs 60) : clustering plus granulaire → plus de pins
      // individuels visibles, clusters plus petits (retour utilisateur #320).
      radius: 40,
      // maxZoom 15 (vs 16) : on dé-clusterise un cran plus tôt.
      maxZoom: 15,
      // Agrège le nombre de venues par famille dans chaque cluster, pour
      // colorer la bulle par famille dominante (séparation visuelle par
      // activité même quand les pins sont regroupés). Cf. retour utilisateur.
      map: (props) => ({ fams: { [props.venue.family_slug]: 1 } }),
      reduce: (acc, props) => {
        for (const slug in props.fams) {
          acc.fams[slug] = (acc.fams[slug] ?? 0) + props.fams[slug];
        }
      },
    });
    // En mode club, les venues rattachées à un club (club_id non null) sont
    // représentées par un pin "club" → on ne garde dans la couche pois que les
    // venues ISOLÉES (club_id null : familles non clusterisées + courts isolés),
    // pour éviter le double affichage tout en ne masquant rien (#311).
    const points = isClubMode ? venues.filter((v) => v.club_id == null) : venues;
    sc.load(
      points.map((v) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        properties: { venue: v },
      }))
    );
    return sc;
  }, [venues, isClubMode]);

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
    onViewportChange?.(c.lat, c.lng, newZoom);
  };

  // Débounce 200ms (#114) sur moveend/zoomend : MapLibre émet l'event en
  // rafale pendant un drag (multiple endings au fil des inertias), et chaque
  // appel naïf déclencherait un fetch. On regroupe en un seul update final.
  // NB : on ne s'abonne PAS à `move` (continu pendant drag) — seulement aux
  // events "end" (cf. spec issue #114).
  const debouncedUpdateViewport = useDebouncedCallback(updateViewport, MOVE_DEBOUNCE_MS);

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
  // Le fix : forcer resize() + triggerRepaint() pour dessiner le 1er frame avec
  // les bonnes dimensions. Un SEUL appel au onLoad ne suffit pas en build de
  // PROD (#100 réapparu) : le onLoad arrive avant que le layout flex/CSS soit
  // stabilisé, le resize capte une taille transitoire et le canvas WebGL ne
  // peint jamais → carte blanche (reproduit en prod ; en dev le double-mount /
  // timing masque le bug). On « kicke » donc le resize sur plusieurs frames
  // (effet ci-dessous) + un ResizeObserver pour tout changement de taille.
  // kickResize ne fait QUE resize/repaint (appelé en boucle) — pas de jumpTo.
  const kickResize = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.resize();
    map.triggerRepaint();
  };

  // Ref toujours à jour vers le flyTarget courant : `handleLoad` est un closure
  // attaché à <Map onLoad> ; sans ref il capturerait une valeur périmée (#408).
  const flyTargetRef = useRef(flyTarget);
  flyTargetRef.current = flyTarget;

  const handleLoad = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.resize();
    // #408 — Deep-link / restauration : un flyTarget posé AVANT que la carte
    // soit prête (MapClient ssr:false → monté après l'effet de restauration de
    // MapWithSearch) a no-opé dans l'effet flyTo (mapRef vide) et n'est jamais
    // re-tenté (token inchangé). On l'applique ici au load en `jumpTo`
    // (instantané), AVANT triggerRepaint pour peindre l'état final (cible) et
    // pas l'état France pré-jump (sinon canvas blanc jusqu'à interaction, #100).
    const pending = flyTargetRef.current;
    if (pending) {
      map.jumpTo({
        center: [pending.lon, pending.lat],
        zoom: pending.zoom ?? 12,
      });
    }
    map.triggerRepaint();
    // #100 réapparu en build prod : ce resize au onLoad est trop précoce → on
    // relance sur les frames suivantes (le filet échelonné complet est l'effet
    // ci-dessous, indépendant de onLoad).
    requestAnimationFrame(kickResize);
    setTimeout(kickResize, 250);
    updateViewport();
  };

  // ResizeObserver sur le container : garantit que MapLibre suit toujours la
  // taille réelle de son conteneur — y compris au settle initial (le RO se
  // déclenche une fois à l'observe) et aux changements de vue (map/list/split).
  // C'est la protection robuste contre la classe de bugs « canvas blanc ».
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => kickResize());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filet de sécurité INDÉPENDANT de onLoad : en build prod, le canvas WebGL ne
  // peint jamais le 1er frame et reste blanc jusqu'à un resize externe (vérifié :
  // un window 'resize' débloque instantanément le rendu). Des setTimeout fixes
  // ne suffisent pas : l'instance MapLibre peut n'être prête qu'après leur
  // fenêtre (init lente en prod) → kickResize no-ope. On POLL donc à intervalle
  // régulier jusqu'à ce que la map existe, puis on force encore quelques
  // resize/repaint après, avant d'arrêter. resize() est idempotent (no-op si la
  // taille est inchangée) → coût négligeable.
  useEffect(() => {
    let ticks = 0;
    let afterReady = 0;
    const id = setInterval(() => {
      ticks += 1;
      const map = mapRef.current?.getMap();
      if (map) {
        map.resize();
        map.triggerRepaint();
        afterReady += 1;
      }
      // Stop : 4 resize après que la map soit prête, ou garde-fou ~6 s.
      if (afterReady >= 4 || ticks >= 40) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Empty filter (l'user a tout décoché) — pas la peine de fetch
  const emptyFilter = selectedFamilies !== undefined && selectedFamilies.size === 0;

  return (
    <div ref={mapContainerRef} className="relative h-full w-full">
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
        onMoveEnd={debouncedUpdateViewport}
        onZoomEnd={debouncedUpdateViewport}
      >
        {/* Zoom +/- en BAS-droite : le haut-droite est occupé par la barre de
            recherche + le toggle Map/List/Side + le bouton Partager (overlays
            de MapWithSearch) qui masquaient le contrôle. Empilé au-dessus du
            bouton géoloc via CSS (cf. globals.css). showCompass off : carte 2D. */}
        <NavigationControl position="bottom-right" showCompass={false} />

        {/* Vector tiles (#226) — quand NEXT_PUBLIC_TILES_URL est défini, le rendu
          des venues vient des tuiles PMTiles (coût O(1)), et les blocs markers
          ci-dessous sont court-circuités via !useTiles. */}
        {useTiles && (
          <VenueTilesLayer
            url={publicEnv.tilesUrl}
            selectedFamilies={selectedFamilies}
            totalFamilies={totalFamilies}
          />
        )}

        {/* Mode agrégats (#114) — bulles de densité (zoom < 10). Fade-out
          coordonné avec le mode POI au swap 9↔10 via opacity CSS. */}
        {!useTiles &&
          !emptyFilter &&
          !presetVenues &&
          aggregates.map((cell) => {
            const size = Math.max(28, Math.min(72, 18 + Math.log2(cell.count + 1) * 7));
            const handleClick = (e: { originalEvent: { stopPropagation: () => void } }) => {
              e.originalEvent.stopPropagation();
              const map = mapRef.current?.getMap();
              if (!map) return;
              // Zoome de +N levels sur la zone cliquée — pratique pour passer
              // d'un agrégat continental à une vue régionale, ou région→POI.
              const targetZoom = Math.min(
                22,
                Math.max(zoomBucket + AGGREGATE_CLICK_ZOOM_BOOST, ZOOM_POI_THRESHOLD)
              );
              map.flyTo({
                center: [cell.lon, cell.lat],
                zoom: targetZoom,
                duration: 600,
                essential: true,
              });
            };
            // Clé : country_code si disponible (zoom<6, stable), sinon coords
            // arrondies (zoom 6-9, cellule degré-alignée — coords toujours
            // équivalentes pour une même cellule).
            const key = cell.country_code
              ? `agg-c-${cell.country_code}`
              : `agg-g-${cell.lat.toFixed(2)}-${cell.lon.toFixed(2)}`;
            return (
              <Marker
                key={key}
                latitude={cell.lat}
                longitude={cell.lon}
                anchor="center"
                onClick={handleClick}
              >
                <button
                  type="button"
                  aria-label={`${cell.count} spots — zoomer`}
                  className="flex cursor-pointer items-center justify-center rounded-full border-2 border-white bg-primary/85 font-semibold text-white shadow-md transition-all hover:scale-110"
                  style={{
                    width: size,
                    height: size,
                    fontSize: size > 48 ? 14 : 12,
                    // Fade-out lors du swap zoom 9→10 : si on est passé en POI
                    // mode mais que setAggregates n'a pas encore vidé (race brève
                    // entre les setState), on cache visuellement.
                    opacity: isAggregateMode ? 1 : 0,
                    transition: `opacity ${FADE_TRANSITION_MS}ms ease-out, transform 150ms`,
                    pointerEvents: isAggregateMode ? "auto" : "none",
                  }}
                >
                  {cell.count.toLocaleString("fr-FR")}
                </button>
              </Marker>
            );
          })}

        {/* Mode POI individuels (zoom ≥ 10, ou presetVenues, ou rétro-compat).
          Fade-in coordonné avec les agrégats au swap zoom 9↔10.
          En mode clubs, la couche pois ne contient que les venues isolées
          (club_id null) — cf. filtre dans le useMemo supercluster ci-dessus. */}
        {!useTiles &&
          !emptyFilter &&
          clusters.map((feature) => {
            const [lon, lat] = feature.geometry.coordinates;
            // Fade quand on quitte le mode POI (ex: dézoom 10→9). En presetVenues
            // on reste toujours opaque (pas de tier zoom à respecter).
            const poiOpacity = presetVenues || !isAggregateMode ? 1 : 0;

            // Cluster bubble (count)
            if ("cluster" in feature.properties && feature.properties.cluster) {
              const cf = feature as ClusterFeature<ClusterProps>;
              const count = cf.properties.point_count;
              const size = Math.min(60, 20 + Math.log2(count) * 8);
              // Famille dominante du cluster → couleur de la bulle (séparation
              // visuelle par activité). Fallback gris si pas d'info famille.
              const fams = cf.properties.fams ?? {};
              let domFam: string | null = null;
              let domCount = -1;
              for (const slug in fams) {
                if (fams[slug] > domCount) {
                  domCount = fams[slug];
                  domFam = slug;
                }
              }
              const clusterColor = domFam ? getFamilyColor(domFam) : "#374151";
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
                      18
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
                    className="flex cursor-pointer items-center justify-center rounded-full border-2 border-white font-semibold text-white shadow-md transition-all hover:scale-110"
                    style={{
                      width: size,
                      height: size,
                      fontSize: size > 36 ? 14 : 12,
                      backgroundColor: clusterColor,
                      opacity: poiOpacity,
                      transition: `opacity ${FADE_TRANSITION_MS}ms ease-in, transform 150ms`,
                    }}
                  >
                    {count}
                  </button>
                </Marker>
              );
            }

            // Pin individuel — pastille colorée par famille portant l'emoji du
            // sport (même icône que l'accueil / les pages sport). Fallback sur
            // l'emoji de famille si le sport n'est pas curé (ex. spa, dance).
            const pf = feature as PointFeature<PointProps>;
            const v = pf.properties.venue;
            const pinEmoji = getSportEmoji(v.primary_sport_slug) ?? getFamilyEmoji(v.family_slug);
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
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-125"
                  style={{
                    backgroundColor: getFamilyColor(v.family_slug),
                    opacity: poiOpacity,
                    transition: `opacity ${FADE_TRANSITION_MS}ms ease-in, transform 150ms`,
                  }}
                >
                  <span aria-hidden="true" className="text-[12px] leading-none">
                    {pinEmoji}
                  </span>
                </button>
              </Marker>
            );
          })}

        {/* Mode clubs : zoom 10-15, familles compatibles. 1 pin/établissement.
          Click → zoom +3 pour révéler les pois individuels.
          Note : ClubMarker appelle e.stopPropagation() → le onClick du Marker
          react-map-gl ne se déclenche pas. On passe uniquement onClick à ClubMarker. */}
        {!useTiles &&
          isClubMode &&
          !emptyFilter &&
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
                  // Ouvre la popup club (liste des courts) + recentre en douceur
                  // sans sauter au zoom POI : on garde la vue club ouverte.
                  setSelected(null);
                  setSelectedClub(club);
                  mapRef.current?.getMap().easeTo({
                    center: [club.lon, club.lat],
                    duration: 400,
                  });
                }}
              />
            </Marker>
          ))}

        {/* Popup club (palier 4, #311) : nom + nombre de courts + liste des courts
          du club, chacun linkable vers sa fiche /venue/[slug]. */}
        {selectedClub && (
          <Popup
            latitude={selectedClub.lat}
            longitude={selectedClub.lon}
            // Ancre dynamique (#649) : maplibre garde la popup dans le conteneur
            // (bascule près d'un bord) au lieu de la couper. La popup club étant
            // plus haute (liste de courts), c'est d'autant plus utile.
            onClose={() => setSelectedClub(null)}
            closeButton
            closeOnClick={false}
            offset={24}
            maxWidth="300px"
          >
            <div className="min-w-[220px] max-w-[280px] space-y-2 p-1 text-sm">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: getFamilyColor(selectedClub.family_slug) }}
                >
                  {getFamilyEmoji(selectedClub.family_slug)}
                </span>
                <span className="font-semibold leading-tight">{selectedClub.name}</span>
              </div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {tMap("clubCourts", { count: selectedClub.courts_count })}
              </p>
              {clubVenues.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tMap("clubCourtsLoading")}</p>
              ) : (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {clubVenues.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/venue/${v.slug}`}
                        className="block rounded px-1.5 py-1 hover:bg-gray-100"
                      >
                        {v.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Popup>
        )}

        {loading && (
          <div className="pointer-events-none absolute right-4 top-20 z-10 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            {tMap("fetching")}
          </div>
        )}

        {selected &&
          (() => {
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
                // Pas d'ancre forcée (#649) : maplibre choisit dynamiquement
                // l'ancre pour que la carte reste DANS le conteneur (préférence
                // « bottom » = ouverture vers le haut quand il y a la place, mais
                // bascule vers le bas/les côtés près d'un bord). Avant, `anchor=
                // "bottom"` figé coupait la fiche pour un pin près du bord haut.
                onClose={() => setSelected(null)}
                closeButton
                closeOnClick={false}
                offset={12}
                maxWidth="320px"
              >
                <div className="min-w-[260px] max-w-[300px] space-y-2.5 p-1 text-sm">
                  {/* Enrichissements Wikimedia/Wikipedia (#107) — lazy-fetch.
                  Ne rend rien si le venue n'est pas enrichi. */}
                  <VenuePopupEnrichments slug={selected.slug} />

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
                      className="-mr-0.5 -mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-yellow-500"
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
                      <p className="text-xs text-gray-500">
                        {getSportEmoji(selected.primary_sport_slug) && (
                          <span aria-hidden="true">
                            {getSportEmoji(selected.primary_sport_slug)}{" "}
                          </span>
                        )}
                        {tSports.has(selected.primary_sport_slug)
                          ? tSports(selected.primary_sport_slug)
                          : selected.primary_sport_slug.replaceAll("_", " ")}
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
                        `https://sporthubmap.com/venue/${selected.slug}`
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

        {/* Point "vous êtes ici" (#feedback Gautier) — rendu en dernier pour
            passer au-dessus des pins. Point bleu cerclé de blanc + halo pulsé. */}
        {userLocation && (
          <Marker latitude={userLocation.lat} longitude={userLocation.lon} anchor="center">
            <div
              className="pointer-events-none relative flex h-5 w-5 items-center justify-center"
              aria-label={tMap("myLocation")}
            >
              <span className="absolute inline-flex h-5 w-5 animate-ping rounded-full bg-blue-500/40" />
              <span className="relative inline-block h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
            </div>
          </Marker>
        )}
      </Map>
    </div>
  );
}
