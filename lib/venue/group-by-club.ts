/**
 * Regroupement AFFICHAGE par CLUB (#696). Le regroupement court-level par
 * nom/coords (`group-courts.ts`) ne réunit PAS des fiches de SURFACES
 * différentes d'un même club (« Courts de tennis terre battue », « Court de
 * tennis béton poreux », « Courts couverts en green set »…) : leurs noms
 * diffèrent, et leurs courts — à 50-100 m les uns des autres — tombent dans des
 * cellules de grille `toFixed(3)` distinctes (vécu : Tennis Lyon, 24 fiches
 * surface listées séparément).
 *
 * Le signal ROBUSTE est `venue.club_id`, posé par le clustering géographique
 * (union-find 50 m, `scripts/cluster_clubs.py`) : toutes les fiches d'un même
 * club partagent un club_id, même réparties sur plusieurs cellules. On collapse
 * donc par club_id en UNE card portant le NOM DU CLUB.
 *
 * Display-only (la donnée brute n'est pas touchée). Conservateur :
 * - on ne collapse qu'à partir de 2 membres ;
 * - seulement si le nom du club est connu (sinon on laisse les fiches intactes,
 *   jamais de card « undefined ») ;
 * - canonique = plus petit id (déterministe) ;
 * - `courts_count` agrégé = somme des membres (le garde-fou #636/#697 plafonne
 *   ensuite l'affichage si la somme devient invraisemblable).
 *
 * À appliquer AVANT `groupCourtRecords` : les canoniques portent alors un vrai
 * nom de club → non court-level → le regroupement par nom ne les retouche pas.
 */

export type ClubGroupable = {
  id: string;
  name: string;
  club_id?: string | null;
  courts_count?: number | null;
};

/**
 * Collapse les venues partageant un `club_id` (connu dans `clubNameById`) en
 * leur card de club (nom du club + `courts_count` agrégé + `groupedCount`). Les
 * venues sans club_id, à club inconnu, ou seules dans leur club, restent
 * intactes (`groupedCount: 1`). Pur, déterministe, testable. Ordre de sortie =
 * première occurrence (la liste est re-triée par qualité en aval).
 */
export function groupByClub<T extends ClubGroupable>(
  venues: T[],
  clubNameById: Map<string, string>,
): (T & { groupedCount: number })[] {
  // 1) indexer les membres par club_id (uniquement clubs connus).
  const groups = new Map<string, T[]>();
  for (const v of venues) {
    const cid = v.club_id;
    if (!cid || !clubNameById.has(cid)) continue;
    const arr = groups.get(cid);
    if (arr) arr.push(v);
    else groups.set(cid, [v]);
  }
  // 2) clubs réellement multi-fiches (≥ 2) ; canonique = plus petit id.
  const canonicalById = new Map<string, T & { groupedCount: number }>();
  const absorbed = new Set<string>();
  for (const [cid, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const canonical = sorted[0];
    const total = sorted.reduce((s, m) => s + (m.courts_count ?? 1), 0);
    canonicalById.set(canonical.id, {
      ...canonical,
      name: clubNameById.get(cid)!,
      courts_count: total,
      groupedCount: sorted.length,
    });
    for (const m of sorted) if (m.id !== canonical.id) absorbed.add(m.id);
  }
  // 3) reconstruire : canoniques réécrits, membres absorbés retirés, reste intact.
  const out: (T & { groupedCount: number })[] = [];
  for (const v of venues) {
    if (absorbed.has(v.id)) continue;
    out.push(canonicalById.get(v.id) ?? { ...v, groupedCount: 1 });
  }
  return out;
}
