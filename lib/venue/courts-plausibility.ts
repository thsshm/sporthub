/**
 * Plausibilité du nombre de courts à l'AFFICHAGE (#555, #636). Certaines venues
 * ont un `courts_count` aberrant (agrégation au niveau équipement/facility mal
 * contrôlée — ex. un « court » de tennis qui remonte 112 terrains, ou un
 * complexe qui en aligne 200). Plutôt que d'afficher une valeur fausse sur une
 * card SEO (perte de confiance : personne ne croit « 112 courts »), on décide à
 * l'affichage entre : montrer le nombre, montrer un libellé plus sûr
 * (« plusieurs terrains »), ou ne rien montrer.
 *
 * NB : ne corrige PAS la donnée (ça relève du dédup #554/#635 et du backfill
 * #555). C'est un garde-fou d'affichage, déterministe et explicable :
 * - seuil par SPORT quand on le connaît (tennis ≠ padel, pourtant même famille
 *   `raquette`), sinon par FAMILLE, sinon défaut ;
 * - au-delà du seuil → libellé « plusieurs terrains » (signal honnête : c'est
 *   multi-court, mais le chiffre n'est pas fiable) ;
 * - au-delà d'un plafond absurde → rien du tout.
 *
 * Conservateur par construction : seuils larges, on ne masque que
 * l'invraisemblable, jamais un vrai gros club crédible.
 */

// Plafond crédible de courts/terrains pour UNE venue, par SPORT. Plus fin que la
// famille : un très gros club de tennis ≈ 25-30 courts ; un club de padel
// dépasse rarement ~16 pistes ; squash/badminton encore moins. Au-delà = quasi
// sûrement une agrégation au mauvais niveau ou un doublon court-level (#635).
const SPORT_MAX_COURTS: Record<string, number> = {
  tennis: 30,
  padel: 16,
  squash: 16,
  badminton: 24,
  table_tennis: 40, // beaucoup de tables dans une même salle
  basketball: 12,
  volleyball: 12,
  football: 12,
  petanque: 60, // un boulodrome peut aligner beaucoup de pistes
};

// Plafond crédible par FAMILLE (fallback quand le sport est inconnu). Aligné sur
// le garde-fou Python (`backfill_courts_count.py`, #555).
const FAMILY_MAX_COURTS: Record<string, number> = {
  raquette: 40, // un très gros centre tennis ≈ 25-30 courts
  ballon: 30,
  boules: 60, // les boulodromes peuvent aligner beaucoup de pistes
  baignade: 25,
  combat: 20,
  fitness: 30,
  yoga: 30,
  nautique: 30,
  glisse: 20,
  snow: 20,
  hike: 20,
  retraites: 20,
  plus: 40,
};
const DEFAULT_MAX = 50;

// Au-delà de ce multiple du seuil, même le libellé « plusieurs terrains » est
// trompeur (agrégation totalement cassée) → on n'affiche rien.
const ABSURD_FACTOR = 4;

// Détection « nom d'équipement générique » (#697). Un enregistrement nommé
// « COURT DE PADEL », « Court de tennis ext », « Terrain de foot » est une LIGNE
// D'ÉQUIPEMENT, pas une destination : son `courts_count` (souvent une agrégation
// au mauvais niveau, ex. « COURT DE PADEL » → 9) n'est pas un compte de club
// fiable. Sur ces noms on n'affiche JAMAIS un chiffre exact — au mieux « plusieurs
// terrains ». Pure heuristique texte (sans accents), conservatrice : ne se
// déclenche que si le nom COMMENCE par un mot d'équipement ET ne contient aucun
// nom propre distinctif (que des mots équipement / sport / remplissage).
const _EQ_LEAD = new Set([
  "court", "courts", "terrain", "terrains", "piste", "pistes", "cancha", "pista",
  "field", "lane", "kort",
]);
const _EQ_FILLER = new Set([
  "de", "du", "des", "d", "le", "la", "les", "l", "en", "et", "a",
  "ext", "exterieur", "exterieurs", "exterieure", "exterieures",
  "int", "interieur", "interieurs", "interieure", "interieures",
  "couvert", "couverts", "couverte", "couvertes", "decouvrable", "decouvrables",
  "n", "no", "num", "central", "centrale", "centraux",
]);
const _EQ_SPORT = new Set([
  "padel", "paddle", "tennis", "squash", "badminton", "foot", "football",
  "basket", "basketball", "volley", "volleyball", "ping", "pong", "tennistable",
]);

/** Normalise (minuscule, sans accents) — local pour éviter une dépendance. */
function _normEq(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * true si `name` ressemble à une ligne d'équipement générique (« COURT DE
 * PADEL », « Court de tennis EXT ») et non à un vrai lieu nommé. Conservateur :
 * doit commencer par un mot d'équipement ET n'avoir QUE des mots
 * équipement/sport/remplissage (un nom propre comme « Casa », « Sportfield »,
 * « Lyon » le disqualifie → ce n'est pas générique).
 */
export function isGenericEquipmentName(name: string | null | undefined): boolean {
  if (!name) return false;
  const toks = _normEq(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && t.length > 1); // ignore nombres & lettres isolées
  if (toks.length === 0) return false;
  if (!_EQ_LEAD.has(toks[0])) return false;
  return toks.every((t) => _EQ_LEAD.has(t) || _EQ_FILLER.has(t) || _EQ_SPORT.has(t));
}

/** Décision d'affichage du nombre de courts. Pur, testable, déterministe. */
export type CourtCountDisplay =
  | { kind: "exact"; count: number } // valeur plausible → on l'affiche
  | { kind: "approx" } // suspecte → libellé « plusieurs terrains »
  | { kind: "none" }; // absente ou absurde → rien

function resolveMax(
  sportSlug: string | null | undefined,
  familySlug: string | null | undefined
): number {
  if (sportSlug && SPORT_MAX_COURTS[sportSlug] != null) return SPORT_MAX_COURTS[sportSlug];
  if (familySlug && FAMILY_MAX_COURTS[familySlug] != null) return FAMILY_MAX_COURTS[familySlug];
  return DEFAULT_MAX;
}

/**
 * Décide comment afficher `count` pour une venue d'un sport/famille donnés.
 * Le sport prime sur la famille (tennis 30 vs padel 16, tous deux `raquette`).
 */
export function getCourtCountDisplay(
  count: number | null | undefined,
  opts: { sportSlug?: string | null; familySlug?: string | null; name?: string | null } = {}
): CourtCountDisplay {
  if (count == null || count <= 0) return { kind: "none" };
  const max = resolveMax(opts.sportSlug, opts.familySlug);
  // #697 : sur un nom d'équipement générique (« COURT DE PADEL », « Court de
  // tennis ext »), le count n'est pas un agrégat de club fiable → jamais de
  // chiffre exact. Au mieux « plusieurs terrains » (≥ 2, sous le plafond
  // absurde), sinon rien. Évite « COURT DE PADEL · 9 terrains » sur une card.
  if (isGenericEquipmentName(opts.name)) {
    if (count >= 2 && count <= max * ABSURD_FACTOR) return { kind: "approx" };
    return { kind: "none" };
  }
  if (count <= max) return { kind: "exact", count };
  if (count <= max * ABSURD_FACTOR) return { kind: "approx" };
  return { kind: "none" };
}

/**
 * Renvoie le nombre de courts s'il est plausible, sinon `null` (= ne pas
 * afficher). Conservé pour la fiche (#555) où l'on masque plutôt que d'afficher
 * un libellé approximatif. Délègue à {@link getCourtCountDisplay} ; accepte
 * désormais un `sportSlug` optionnel pour la granularité par sport.
 */
export function plausibleCourtCount(
  count: number | null | undefined,
  familySlug: string | null | undefined,
  sportSlug?: string | null
): number | null {
  const d = getCourtCountDisplay(count, { familySlug, sportSlug });
  return d.kind === "exact" ? d.count : null;
}
