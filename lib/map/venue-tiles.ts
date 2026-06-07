/**
 * Helpers de rendu des venues en tuiles vectorielles PMTiles (#226, étape 4).
 *
 * Purs et testables sans MapLibre : construisent les expressions de style GL
 * (couleur par famille, rayon par zoom), le filtre familles, et l'URL de source
 * pmtiles://. Le composant `VenueTilesLayer` les consomme.
 *
 * Le layer source des tuiles s'appelle "venues" et porte la propriété `fam`
 * (family_slug) — cf. `scripts/generate_venue_tiles.py` (TILE_LAYER + props).
 */
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import { FAMILIES, getFamilyColor } from "@/lib/families";

export const VENUE_TILES_SOURCE_ID = "venue-tiles";
export const VENUE_TILES_LAYER_ID = "venue-tiles-circles";
/** Doit matcher TILE_LAYER de scripts/generate_venue_tiles.py. */
export const VENUE_TILES_SOURCE_LAYER = "venues";

/** Couleur de repli pour toute famille inconnue dans la tuile. */
export const FALLBACK_COLOR = "#6b7280";

/**
 * Expression MapLibre `match` : propriété `fam` → couleur de marque de la
 * famille (cf. CLAUDE.md). Fallback gris si la famille n'est pas reconnue.
 */
export function buildFamilyColorExpression(): ExpressionSpecification {
  const expr: unknown[] = ["match", ["get", "fam"]];
  for (const f of FAMILIES) {
    expr.push(f.slug, getFamilyColor(f.slug));
  }
  expr.push(FALLBACK_COLOR);
  return expr as unknown as ExpressionSpecification;
}

/**
 * Rayon du cercle interpolé par zoom : petits points en vue large, plus gros
 * au zoom rue. Reste lisible sans surcharger les tuiles denses.
 */
export function buildCircleRadiusExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4, 2,
    10, 4,
    14, 6,
  ] as unknown as ExpressionSpecification;
}

/**
 * Filtre GL sur un sous-ensemble de familles, ou `undefined` si aucun filtre
 * pertinent (rien de coché, ou toutes les familles cochées). Filtrage natif
 * côté tuile — pas de re-fetch, contrairement au chemin /api/venues.
 */
export function buildFamilyFilter(
  selectedFamilies?: Set<string>,
  totalFamilies?: number,
): FilterSpecification | undefined {
  if (
    !selectedFamilies ||
    !totalFamilies ||
    selectedFamilies.size === 0 ||
    selectedFamilies.size >= totalFamilies
  ) {
    return undefined;
  }
  return [
    "in",
    ["get", "fam"],
    ["literal", Array.from(selectedFamilies)],
  ] as unknown as FilterSpecification;
}

/**
 * Filtre TOUJOURS valide pour le layer tuiles (jamais `undefined`).
 *
 * MapLibre `addLayer` REJETTE `filter: undefined` (« array expected, undefined
 * found ») → l'exception casse tout le rendu : carte BLANCHE (incident
 * d'activation #226). `buildFamilyFilter` renvoie `undefined` quand aucun
 * sous-ensemble n'est sélectionné ; on le remplace alors par `["all"]`
 * (combinateur GL sans condition = toujours vrai → affiche toutes les venues).
 * À utiliser à la place de `buildFamilyFilter` côté composant Layer.
 */
export function venueTilesFilter(
  selectedFamilies?: Set<string>,
  totalFamilies?: number,
): FilterSpecification {
  return (
    buildFamilyFilter(selectedFamilies, totalFamilies) ??
    (["all"] as unknown as FilterSpecification)
  );
}

/** URL de source MapLibre pour un .pmtiles hébergé (préfixe `pmtiles://`). */
export function pmtilesSourceUrl(tilesUrl: string): string {
  return `pmtiles://${tilesUrl}`;
}
