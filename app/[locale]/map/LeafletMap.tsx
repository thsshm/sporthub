"use client";

/**
 * Carte de REPLI sans WebGL (#466). MapLibre exige WebGL ; quand le navigateur
 * ne l'a pas (accélération matérielle coupée, vieux GPU…), on rend ici une carte
 * Leaflet **raster** (tuiles images via <img>, comme le fallback de Google/Apple
 * Maps) → la carte s'affiche quel que soit le paramétrage navigateur.
 *
 * Leaflet est self-hosté (/public/vendor/leaflet) → même origine, aucune
 * dépendance externe au runtime (marche dès que le site marche). Chargé à la
 * demande, donc seulement pour les utilisateurs sans WebGL.
 *
 * Mêmes tuiles CARTO que MapLibre + marqueurs venues (fetch /api/venues par
 * bbox, mode POIs) + clic → fiche. Volontairement minimal (pas de clustering /
 * filtres avancés) : l'objectif est une carte FONCTIONNELLE, pas la parité.
 */
import { useEffect, useRef } from "react";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import type { VenuePin } from "@/lib/supabase/types";

const LEAFLET_JS = "/vendor/leaflet/leaflet.js";
const LEAFLET_CSS = "/vendor/leaflet/leaflet.css";
const CARTO_TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";

// ── Surface minimale typée de l'API Leaflet utilisée (évite `any`). ────────────
interface LBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}
interface LLayer {
  addTo(target: LMap | LLayerGroup): LLayer;
  bindPopup(html: string): LLayer;
}
interface LLayerGroup {
  addTo(map: LMap): LLayerGroup;
  clearLayers(): void;
}
interface LMap {
  setView(center: [number, number], zoom: number): LMap;
  getBounds(): LBounds;
  on(event: string, handler: () => void): void;
  remove(): void;
}
interface LStatic {
  map(el: HTMLElement, opts?: Record<string, unknown>): LMap;
  tileLayer(url: string, opts?: Record<string, unknown>): LLayer;
  layerGroup(): LLayerGroup;
  marker(latlng: [number, number], opts?: Record<string, unknown>): LLayer;
  divIcon(opts: Record<string, unknown>): unknown;
}
type WindowWithL = Window & { L?: LStatic };

/** Charge Leaflet (CSS + JS same-origin) une seule fois, puis résout `window.L`. */
function loadLeaflet(): Promise<LStatic> {
  return new Promise((resolve, reject) => {
    const w = window as WindowWithL;
    if (w.L) {
      resolve(w.L);
      return;
    }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const done = () => (w.L ? resolve(w.L) : reject(new Error("Leaflet absent")));
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${LEAFLET_JS}"]`,
    );
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("load error")));
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error("load error"));
    document.head.appendChild(script);
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

type Props = {
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  initialVenues?: VenuePin[];
  locale: string;
};

export default function LeafletMap({
  initialLat,
  initialLon,
  initialZoom,
  initialVenues,
  locale,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: LMap | null = null;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        map = L.map(containerRef.current, { zoomControl: true }).setView(
          [initialLat, initialLon],
          initialZoom,
        );
        L.tileLayer(CARTO_TILES, {
          subdomains: "abcd",
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
        }).addTo(map);

        const layer = L.layerGroup().addTo(map);
        const render = (venues: VenuePin[]) => {
          layer.clearLayers();
          for (const v of venues) {
            const color = FAMILIES_BY_SLUG[v.family_slug]?.color ?? "#2d7a3e";
            const icon = L.divIcon({
              className: "",
              html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            });
            const href = `/${locale}/venue/${v.slug}`;
            L.marker([v.lat, v.lon], { icon })
              .bindPopup(
                `<a href="${href}" style="font-weight:600">${escapeHtml(v.name)}</a>`,
              )
              .addTo(layer);
          }
        };

        if (initialVenues && initialVenues.length > 0) render(initialVenues);

        const fetchInView = () => {
          if (!map) return;
          const b = map.getBounds();
          const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
          // Sans `zoom` → l'API renvoie le mode "pois" (venues individuels).
          fetch(`/api/venues?bbox=${bbox}&limit=800`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { mode?: string; venues?: VenuePin[] } | null) => {
              if (cancelled || !data || data.mode !== "pois" || !data.venues)
                return;
              render(data.venues);
            })
            .catch(() => {
              /* réseau : on garde les marqueurs courants */
            });
        };

        fetchInView();
        map.on("moveend", fetchInView);
      })
      .catch(() => {
        /* Leaflet n'a pas pu charger : conteneur vide plutôt qu'un crash. */
      });

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [initialLat, initialLon, initialZoom, locale, initialVenues]);

  return <div ref={containerRef} className="h-full w-full" />;
}
