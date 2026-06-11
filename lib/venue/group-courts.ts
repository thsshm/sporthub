/**
 * Regroupement AFFICHAGE des enregistrements court-level (#635). Certaines
 * sources livrent une venue par court/piste — « Court de Padel 1/2/3 »,
 * « Sportfield 16 piste 1/2/3 », « Terrain n°4 »… La page ressemble alors à une
 * base de données brute (l'utilisateur cherche un CLUB, pas une piste isolée).
 *
 * Ce module regroupe ces doublons à l'AFFICHAGE, sans toucher la donnée brute
 * (contrainte #635 ; le merge DB définitif relève de `scripts/etl/merge_court_records.py`,
 * #554). Mêmes règles que le script Python pour que les deux convergent :
 * - candidat = nom finissant par un numéro (`base_name` ≠ null) ;
 * - clé de groupe = base normalisée + source + sport + coords arrondies (~110 m) ;
 * - on ne fusionne QUE les groupes ≥ 2 membres (un « Stade 2000 » solitaire reste
 *   tel quel — jamais renommé) ;
 * - canonique = plus petit id (déterministe, identique au merge DB) ;
 * - `courts_count` agrégé = somme des membres (le garde-fou #636 plafonne ensuite
 *   l'affichage si la somme devient invraisemblable).
 *
 * Conservateur : même source + même sport + mêmes coords arrondies exigés → on ne
 * sur-fusionne pas des venues distantes ou hétérogènes (contrainte #635). Un nom
 * générique sans numéro (« COURT DE PADEL ») n'est pas un candidat → reste séparé.
 */

export type GroupableVenue = {
  id: string;
  name: string;
  source?: string | null;
  primary_sport_slug?: string | null;
  lat: number;
  lon: number;
  courts_count?: number | null;
};

// Patterns alignés sur scripts/etl/merge_court_records.py (#554).
const NUM_SUFFIX = /\s+n?[°o]?\s*\d+\s*$/i;
const COURT_WORD = /\s+(piste|court|terrain|cancha|pista|field|lane|kart)\s*$/i;

function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Nom de base si `name` ressemble à un court numéroté, sinon null. */
export function baseName(name: string): string | null {
  const stripped = name.replace(NUM_SUFFIX, "").trim();
  if (stripped === name.trim() || !stripped) return null; // pas de numéro final
  return stripped;
}

/** Nom de carte = base sans le mot-court résiduel (« … piste » → « … »). */
export function displayName(groupBase: string): string {
  const n = groupBase.replace(COURT_WORD, "").trim();
  return n || groupBase;
}

/** ~110 m : assez serré pour ne pas fusionner deux clubs voisins distincts. */
function coordKey(v: GroupableVenue): string {
  return `${v.lat.toFixed(3)},${v.lon.toFixed(3)}`;
}

/**
 * Regroupe les doublons court-level d'une liste de venues (déjà filtrée par
 * ville/sport en amont). Renvoie une liste où chaque groupe ≥ 2 est réduit à sa
 * venue canonique (nom de club + `courts_count` agrégé + `groupedCount`), les
 * autres venues étant conservées intactes. Pur, déterministe, testable.
 *
 * Ordre de sortie = première occurrence (la liste est de toute façon re-triée par
 * qualité en aval).
 */
export function groupCourtRecords<T extends GroupableVenue>(
  venues: T[]
): (T & { groupedCount: number })[] {
  // 1) indexer les membres par clé de groupe (uniquement les candidats court-level).
  const groups = new Map<string, T[]>();
  for (const v of venues) {
    const base = baseName(v.name);
    if (!base) continue;
    const key = `${norm(base)}|${v.source ?? ""}|${v.primary_sport_slug ?? ""}|${coordKey(v)}`;
    const arr = groups.get(key);
    if (arr) arr.push(v);
    else groups.set(key, [v]);
  }
  // 2) clés réellement fusionnables (≥ 2 membres) ; canonique = plus petit id.
  const canonicalById = new Map<string, T & { groupedCount: number }>();
  const absorbed = new Set<string>(); // ids non-canoniques à masquer
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const canonical = sorted[0];
    const total = sorted.reduce((s, m) => s + (m.courts_count ?? 1), 0);
    canonicalById.set(canonical.id, {
      ...canonical,
      name: displayName(baseName(canonical.name) ?? canonical.name),
      courts_count: total,
      groupedCount: sorted.length,
    });
    for (const m of sorted) if (m.id !== canonical.id) absorbed.add(m.id);
  }
  // 3) reconstruire la liste : canoniques réécrits, doublons retirés, reste intact.
  const out: (T & { groupedCount: number })[] = [];
  for (const v of venues) {
    if (absorbed.has(v.id)) continue;
    const merged = canonicalById.get(v.id);
    out.push(merged ?? { ...v, groupedCount: 1 });
  }
  return out;
}
