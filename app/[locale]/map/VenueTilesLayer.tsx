"use client";

import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";
import type { CircleLayerSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import {
  VENUE_TILES_LAYER_ID,
  VENUE_TILES_SOURCE_ID,
  VENUE_TILES_SOURCE_LAYER,
  buildCircleRadiusExpression,
  buildFamilyColorExpression,
  venueTilesFilter,
  pmtilesSourceUrl,
} from "@/lib/map/venue-tiles";

// Le protocole pmtiles:// s'enregistre sur le runtime MapLibre GLOBAL : une
// seule fois pour toute l'app. Le ré-enregistrer lève un warning MapLibre, d'où
// le garde module-level (survit aux remounts du composant).
let pmtilesRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

type Props = {
  /** URL publique du `.pmtiles` (NEXT_PUBLIC_TILES_URL), non vide. */
  url: string;
  selectedFamilies?: Set<string>;
  totalFamilies?: number;
};

/**
 * Rendu des venues via tuiles vectorielles PMTiles (#226, étape 4).
 *
 * Source `vector` lue depuis `pmtiles://<url>`, layer `circle` coloré par
 * famille. Coût O(1) côté carte — remplace le fetch /api/venues + Supercluster
 * quand `NEXT_PUBLIC_TILES_URL` est défini. Le filtrage familles est natif (GL
 * filter), sans re-fetch.
 *
 * Hors scope de cette première intégration : clic/popup sur les features
 * vectorielles (`interactiveLayerIds` + `queryRenderedFeatures`) — suite #226.
 */
export default function VenueTilesLayer({
  url,
  selectedFamilies,
  totalFamilies,
}: Props) {
  useEffect(() => {
    ensurePmtilesProtocol();
  }, []);

  const paint: CircleLayerSpecification["paint"] = {
    "circle-radius": buildCircleRadiusExpression(),
    "circle-color": buildFamilyColorExpression(),
    "circle-stroke-width": 1,
    "circle-stroke-color": "#ffffff",
    "circle-opacity": 0.9,
  };

  return (
    <Source id={VENUE_TILES_SOURCE_ID} type="vector" url={pmtilesSourceUrl(url)}>
      <Layer
        id={VENUE_TILES_LAYER_ID}
        type="circle"
        source-layer={VENUE_TILES_SOURCE_LAYER}
        filter={venueTilesFilter(selectedFamilies, totalFamilies)}
        paint={paint}
      />
    </Source>
  );
}
