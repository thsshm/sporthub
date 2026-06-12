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
  lat?: number;
  lon?: number;
  primary_sport_slug?: string | null;
};

// Rayon d'« aspiration » (#696) d'une fiche-équipement orpheline vers un club
// voisin du même sport. Volontairement > rayon de clustering (50 m) pour
// rattraper les courts d'un club ÉTALÉ que l'union-find n'a pas chaînés (vécu :
// « court de tennis béton poreux » à côté de son club mais > 50 m du plus proche
// membre chaîné), mais < distance typique entre clubs distincts → pas de
// sur-fusion. N'absorbe QUE des noms d'ÉQUIPEMENT génériques (sans identité
// propre) : un vrai lieu nommé voisin n'est jamais aspiré.
const SNAP_M = 150;

// Libellé de COURT/SURFACE (#696) — prédicat LOCAL volontairement plus large
// que `isGenericEquipmentName` (#697, focalisé sur l'affichage du compteur) : il
// doit reconnaître les descripteurs de surface (« béton poreux », « terre
// battue », « green set », « mur de tennis »…) pour décider quelles fiches
// ORPHELINES sont des courts aspirables. Un nom propre (« Tennis Club Chavril »,
// « Terrain de Sports Marius Bourrat ») n'est jamais matché : doit COMMENCER par
// un mot d'équipement ET n'avoir QUE des mots équipement / sport / surface.
const _COURT_LEAD = new Set([
  "court", "courts", "terrain", "terrains", "piste", "pistes", "salle", "salles",
  "halle", "halles", "mur", "murs", "cancha", "pista", "kort",
]);
const _COURT_OK = new Set([
  // remplissage
  "de", "du", "des", "d", "le", "la", "les", "l", "en", "et", "a", "n", "no", "non",
  // sports
  "tennis", "padel", "paddle", "squash", "badminton", "foot", "football", "basket",
  "basketball", "volley", "volleyball", "ping", "pong",
  // surfaces / qualificatifs
  "ext", "int", "exterieur", "exterieurs", "exterieure", "exterieures",
  "interieur", "interieurs", "interieure", "interieures",
  "couvert", "couverts", "couverte", "couvertes", "decouvert", "decouverts",
  "decouverte", "decouvertes", "decouvrable", "decouvrables",
  "terre", "battue", "beton", "poreux", "green", "set", "gazon", "resine",
  "synthetique", "synthetiques", "bois", "dur", "durs", "quick", "gelive", "gelives",
  "gelif", "traditionnelle", "traditionnel", "traditionnelles",
  "central", "centrale", "centraux", "municipaux", "municipal",
]);

function isCourtSurfaceLabel(name: string | null | undefined): boolean {
  if (!name) return false;
  const toks = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && t.length > 1);
  if (toks.length === 0 || !_COURT_LEAD.has(toks[0])) return false;
  return toks.every((t) => _COURT_LEAD.has(t) || _COURT_OK.has(t));
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
  // 2bis) ASPIRATION des orphelins-équipement (#696) : une fiche au nom
  // d'équipement générique (« court de tennis béton poreux »…), sans club, mais
  // à ≤ SNAP_M d'un club du MÊME sport, est un court de ce club que le
  // clustering a raté de peu → on l'absorbe dans la card du club. Déterministe :
  // ancres triées par id, plus proche d'abord (id en tie-break).
  const anchors = [...canonicalById.values()]
    .filter((c) => c.lat != null && c.lon != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (anchors.length > 0) {
    for (const v of venues) {
      if (absorbed.has(v.id) || canonicalById.has(v.id)) continue;
      if (v.lat == null || v.lon == null || !isCourtSurfaceLabel(v.name)) continue;
      let best: (T & { groupedCount: number }) | null = null;
      let bestD = SNAP_M;
      for (const a of anchors) {
        if ((a.primary_sport_slug ?? null) !== (v.primary_sport_slug ?? null)) continue;
        const d = haversineM(v.lat, v.lon, a.lat as number, a.lon as number);
        if (d <= bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) {
        best.courts_count = (best.courts_count ?? 0) + (v.courts_count ?? 1);
        best.groupedCount += 1;
        absorbed.add(v.id);
      }
    }
  }
  // 3) reconstruire : canoniques réécrits, membres absorbés retirés, reste intact.
  const out: (T & { groupedCount: number })[] = [];
  for (const v of venues) {
    if (absorbed.has(v.id)) continue;
    out.push(canonicalById.get(v.id) ?? { ...v, groupedCount: 1 });
  }
  return out;
}
