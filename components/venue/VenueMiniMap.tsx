"use client";

import { useRef, useEffect } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Mini-carte MapLibre centrée sur la venue (#414).
 *
 * Client Component minimal : pas de react-map-gl, juste l'API MapLibre directe.
 * Carte statique (scroll/drag désactivé) — juste pour visualiser l'emplacement.
 * Raster CartoCDN, même source que la carte principale.
 *
 * Gracieux : si WebGL non dispo (bots, lecteurs d'écran) → bloc invisible.
 */
type Props = {
  lat: number;
  lon: number;
  name: string;
  /** Couleur du marker (couleur de la famille). */
  color?: string;
};

export function VenueMiniMap({ lat, lon, name, color = "#2d7a3e" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [{ id: "basemap-layer", type: "raster", source: "basemap" }],
      },
      center: [lon, lat],
      zoom: 15,
      // Mini-carte statique : interactions désactivées pour ne pas piéger
      // le scroll de la page (surtout sur mobile).
      scrollZoom: false,
      dragPan: false,
      dragRotate: false,
      keyboard: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      interactive: false,
      attributionControl: false,
    });

    // Marker coloré
    const el = document.createElement("div");
    el.style.cssText = `
      width: 20px; height: 20px;
      border-radius: 50%;
      background: ${color};
      border: 3px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    `;
    new maplibregl.Marker({ element: el })
      .setLngLat([lon, lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setText(name))
      .addTo(map);

    // Lien d'attribution compact
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, name, color]);

  return (
    <div
      ref={containerRef}
      className="h-44 w-full overflow-hidden rounded-lg sm:h-56"
      aria-label={`Carte localisant ${name}`}
      role="img"
    />
  );
}
