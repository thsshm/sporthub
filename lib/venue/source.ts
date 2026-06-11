/**
 * Provenance d'une venue (#562) — mappe la valeur brute `venue.source` vers un
 * libellé de confiance affichable (« Vérifié depuis OpenStreetMap »).
 *
 * Les sources ouvertes (OSM, RES, Wikidata, Overture) renforcent la promesse
 * « Only real spots ». Les sources internes/partenaires non vérifiables
 * (hyrox, import V1…) renvoient `null` → pas de badge (on n'affiche un signal de
 * confiance que pour une provenance ouverte réelle).
 */

export type VenueSourceMeta = {
  /** Clé normalisée (osm/res/wikidata/overture). */
  key: string;
  /** Libellé affiché. */
  label: string;
  /** Lien vers la source / sa licence. */
  url: string;
};

const SOURCES: Record<string, VenueSourceMeta> = {
  osm: {
    key: "osm",
    label: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
  },
  openstreetmap: {
    key: "osm",
    label: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
  },
  res: {
    key: "res",
    label: "RES (Ministère des Sports)",
    url: "https://data.sports.gouv.fr",
  },
  wikidata: {
    key: "wikidata",
    label: "Wikidata",
    url: "https://www.wikidata.org",
  },
  overture: {
    key: "overture",
    label: "Overture Maps",
    url: "https://overturemaps.org",
  },
};

/** Retourne la provenance affichable, ou null si la source est inconnue/interne. */
export function getVenueSourceMeta(source: string | null | undefined): VenueSourceMeta | null {
  if (!source) return null;
  const s = source.trim().toLowerCase();
  // Exact d'abord, puis fallback sur le PRÉFIXE avant le 1er « - » : les sources
  // réelles sont souvent suffixées (res-raquette, res-boules, wikidata-retreats…)
  // → sans ça le badge ne s'affichait jamais pour elles (gap #562/#607). osm/
  // overture restent exacts ; les internes (hyrox, playtomic…) → null.
  return SOURCES[s] ?? SOURCES[s.split("-")[0]] ?? null;
}
