/**
 * Helpers purs pour les compteurs à facettes du panneau de filtres (#279).
 * Logique extraite de app/api/venues/facets/route.ts pour être testable
 * (convention : helpers dans lib/, cf. CLAUDE.md #9). La RPC SQL
 * `venues_facets_in_bbox` (migration 0019) retourne des lignes plates
 * (facet_type, facet_key, n) ; ces helpers les pivotent / fusionnent.
 */

export type FacetRow = { facet_type: string; facet_key: string; n: number };

export type FacetCounts = {
  family: Record<string, number>;
  criteria: Record<string, number>;
  surface: Record<string, number>;
};

/** Pivote les lignes plates (facet_type, facet_key, n) en 3 maps typées. */
export function pivotFacets(rows: FacetRow[]): FacetCounts {
  const out: FacetCounts = { family: {}, criteria: {}, surface: {} };
  for (const r of rows) {
    if (r.facet_type === "family") out.family[r.facet_key] = Number(r.n);
    else if (r.facet_type === "criteria") out.criteria[r.facet_key] = Number(r.n);
    else if (r.facet_type === "surface") out.surface[r.facet_key] = Number(r.n);
    // facet_type inconnu → ignoré (robustesse si la RPC évolue)
  }
  return out;
}

/**
 * Additionne les `n` de 2 jeux de facettes par (facet_type, facet_key).
 * Utilisé pour fusionner les 2 moitiés d'une bbox antiméridien. Ne mute pas
 * les entrées d'origine.
 */
export function mergeFacets(a: FacetRow[], b: FacetRow[]): FacetRow[] {
  const acc = new Map<string, FacetRow>();
  for (const r of [...a, ...b]) {
    const key = `${r.facet_type}|${r.facet_key}`;
    const prev = acc.get(key);
    if (prev) prev.n += Number(r.n);
    else acc.set(key, { facet_type: r.facet_type, facet_key: r.facet_key, n: Number(r.n) });
  }
  return [...acc.values()];
}
