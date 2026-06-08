"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { VenuePin } from "@/lib/supabase/types";
import type { FlyTarget } from "@/app/[locale]/map/MapClient";
import { formatCount } from "@/lib/utils";
import { SPORTS_BY_SLUG } from "@/lib/sports";

const MapClient = dynamic(() => import("@/app/[locale]/map/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

// Ne jamais redemander la permission de géoloc navigateur en auto. Clé partagée
// avec la carte principale (/map, cf. MapWithSearch #214) : si l'utilisateur a
// déjà été sollicité là-bas, on ne le re-sollicite pas ici.
const GEO_PROMPTED_KEY = "sporthub_geo_prompted";

type Props = {
  /** Slug du sport pour le filtrage côté API (mode bbox-aware) */
  sportSlug: string;
  /** Venues initiaux (les 24 de la page courante) — utilisés pour calculer
   * un bbox de départ raisonnable + affichés instantanément. */
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
 * Carte avec bbox-aware fetch filtré par sport. Sur /sports/[sport].
 * Au mount, affiche les venues initiaux fournis. Dès que l'user pan/zoom,
 * refetch via /api/venues?sport=X&bbox=... pour tous les venues du sport
 * dans la nouvelle vue.
 *
 * Géolocalisation auto au mount : la page sport ouvrait sur la France entière
 * (bbox des venues initiaux, vue agrégats PMTiles tous-sports) sans recentrage.
 * On géolocalise donc l'utilisateur et on zoome chez lui — ce qui, en plus de
 * recentrer, fait basculer l'affichage sur la couche API filtrée par sport
 * (les pins deviennent ceux du sport, près de l'utilisateur). Même logique que
 * la carte principale, mais SportPageMap utilise MapClient en direct (sans
 * MapWithSearch qui portait jusqu'ici toute la logique #214).
 */
export function SportPageMap({
  sportSlug,
  initialVenues,
  totalSportVenues,
  onVenuesData,
  flyTarget,
}: Props) {
  const tSport = useTranslations("sport");
  const tSports = useTranslations("sports");
  const sportName = tSports.has(sportSlug) ? tSports(sportSlug) : sportSlug;
  const sportEmoji = SPORTS_BY_SLUG[sportSlug]?.emoji ?? "📍";
  const [visibleCount, setVisibleCount] = useState(initialVenues.length);

  // flyTarget géoloc auto (interne). Le flyTarget explicite du parent (clic sur
  // un item de la liste) reste prioritaire — cf. effectiveFlyTarget plus bas.
  const [geoFlyTarget, setGeoFlyTarget] = useState<FlyTarget | null>(null);

  // Dès qu'une intention explicite du parent recentre la carte, la géoloc auto
  // ne doit plus écraser ce choix (anti-race, comme userMovedRef dans #214).
  const parentMovedRef = useRef(false);
  useEffect(() => {
    if (flyTarget) parentMovedRef.current = true;
  }, [flyTarget]);

  // Géoloc précise (navigateur) → recentre en zoom 12 si l'utilisateur autorise.
  // Gardée par GEO_PROMPTED_KEY : on ne redemande jamais la permission en auto.
  const precisePosRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;
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
        if (parentMovedRef.current) return;
        precisePosRef.current = true; // position précise : prime sur la géoloc IP
        setGeoFlyTarget({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          zoom: 12,
          token: Date.now(),
        });
      },
      () => markPrompted(),
      { timeout: 8000, maximumAge: 60_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Géoloc approximative par IP (/api/geo, edge Vercel, SANS permission) →
  // recentrage instantané sur la région du visiteur dès le mount. La géoloc
  // précise ci-dessus raffine ensuite (zoom 12) si elle est autorisée.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/geo");
        if (!res.ok) return;
        const { geo } = (await res.json()) as {
          geo: { lat: number; lon: number } | null;
        };
        if (cancelled || !geo || parentMovedRef.current || precisePosRef.current) return;
        setGeoFlyTarget({ lat: geo.lat, lon: geo.lon, zoom: 11, token: Date.now() });
      } catch {
        /* /api/geo indispo (dev local) → on garde la vue par défaut */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Priorité : intention explicite du parent (clic liste) > géoloc auto.
  const effectiveFlyTarget = flyTarget ?? geoFlyTarget;

  // Calc initial center + zoom depuis les venues initiaux (fallback si géoloc
  // indisponible / refusée → on garde une vue France raisonnable).
  const initial = (() => {
    if (initialVenues.length === 0) {
      return { lat: 46.5, lon: 2.5, zoom: 5 };
    }
    const lats = initialVenues.map((v) => v.lat);
    const lons = initialVenues.map((v) => v.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const span = Math.max(maxLat - minLat, maxLon - minLon);
    const zoom =
      span > 50 ? 2 : span > 20 ? 4 : span > 8 ? 6 : span > 3 ? 8 : span > 0.5 ? 11 : 13;
    return { lat: centerLat, lon: centerLon, zoom };
  })();

  return (
    <div className="relative h-[400px] w-full overflow-hidden rounded-lg border">
      <MapClient
        initialLat={initial.lat}
        initialLon={initial.lon}
        initialZoom={initial.zoom}
        selectedSport={sportSlug}
        onVenuesChange={setVisibleCount}
        onVenuesData={onVenuesData}
        flyTarget={effectiveFlyTarget}
      />
      {/* Chip de scope : rend visible le filtre sport actif (#466) — sinon la
          carte paraissait montrer "tout" sans indiquer qu'elle est filtrée. */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-xs font-medium shadow backdrop-blur">
        <span aria-hidden="true">{sportEmoji}</span>
        <span>{sportName}</span>
      </div>

      {/* Compteur "N dans la vue / M au total" — i18n (#466 : était hardcodé EN). */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-background/90 px-2 py-1 text-[11px] shadow backdrop-blur">
        {totalSportVenues != null
          ? tSport("mapVisibleOfTotal", {
              visible: formatCount(visibleCount),
              total: formatCount(totalSportVenues),
            })
          : tSport("mapInView", { count: formatCount(visibleCount) })}
      </div>
    </div>
  );
}
