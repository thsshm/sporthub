/**
 * Règles data-quality PAR SPORT (#638) — carte configurable de signaux
 * positifs / négatifs sur le NOM d'une venue, pour des listes SEO crédibles.
 *
 * Généralise l'approche binaire « nom ↔ sport contradictoire » (#553) en trois
 * familles de signaux, faciles à éditer :
 * - `positive`    : le nom indique clairement le sport → on PROMEUT au ranking.
 * - `contradiction`: le nom désigne clairement un AUTRE équipement → on EXCLUT
 *                    des listes mono-sport (la venue reste sur la carte/sa fiche).
 * - `suspicious`  : douteux mais possible (multi-sport, organisation, loisir…) →
 *                    on RÉTROGRADE seulement (jamais d'exclusion dure ici).
 *
 * Conforme aux garde-fous #638 : démotion avant exclusion ; une venue multi-sport
 * qui porte un signal POSITIF n'est jamais rétrogradée comme douteuse. Logique
 * PURE (normalisation + regex à frontière de mot sur texte sans accents) →
 * testable sans DB. Jamais de substring nu (cicatrice #487/#591 : « tank » ⊄
 * « Pétanque »). La détection « organisation » générique reste dans
 * quality-score.ts (`isOrganizationName`, #588) — complémentaire.
 */

/** Normalise pour le matching : minuscules + accents retirés. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Regex « mot entier » sur texte normalisé (pas de lettre adjacente). */
const w = (term: string) =>
  new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`);

/**
 * Équipement multi-activités générique : suspect sur TOUTE page mono-sport
 * (l'installation n'est pas dédiée au sport). Traité comme contradiction (exclu)
 * car historiquement #553 — préfixes volontaires (`polyvalente`, `multisports`).
 */
export const GENERIC_MULTISPORT = [/\bmultisports?\b/, /\bomnisports?\b/, /\bpolyvalente?s?\b/];

export type SportRule = {
  positive: RegExp[];
  contradiction: RegExp[];
  suspicious: RegExp[];
};

// Contradictions « équipement clairement autre » — REPRISES À L'IDENTIQUE de
// #553 (SPORT_MISMATCH) pour ne pas régresser l'exclusion existante.
const C_RAQUETTE = [
  /\bpiscines?\b/,
  /\bmusculation\b/,
  /\bfitness\b/,
  /\bnatation\b/,
  /\bboulodromes?\b/,
  /\bpatinoires?\b/,
];
const C_BALLON = [...C_RAQUETTE];

/**
 * Carte de règles. Volontairement courte et factuelle (exemples réels des audits
 * #553/#637/#638) ; élargir au cas par cas, jamais en masse (faux positifs).
 */
export const SPORT_RULES: Record<string, SportRule> = {
  tennis: {
    positive: [w("tennis"), /tennis club/, w("court"), w("courts"), w("fft"), /roland.?garros/],
    contradiction: C_RAQUETTE,
    suspicious: [], // pool/muscu sont déjà des contradictions ; multisport = générique
  },
  padel: {
    positive: [w("padel"), w("padel"), w("paddle"), /casa padel/, w("padellers"), /padel club/],
    contradiction: C_RAQUETTE,
    // tennis SANS signal padel (le positif l'emporte), + équestre / circuits.
    suspicious: [
      w("tennis"),
      /\bmanege\b/,
      /\becuries?\b/,
      /\bhippodromes?\b/,
      /\bharas\b/,
      /\bhippique\b/,
      /\bcircuit\b/,
      /\bkarting\b/,
    ],
  },
  gym: {
    // musculation/fitness sont POSITIFS pour le gym (cf. #553).
    positive: [
      w("gym"),
      w("fitness"),
      /basic.?fit/,
      /keep.?cool/,
      /fitness park/,
      w("crossfit"),
      w("studio"),
      w("coaching"),
      w("musculation"),
      w("pilates"),
    ],
    contradiction: [/\bpiscines?\b/, /\bnatation\b/, /\bboulodromes?\b/, /\bpatinoires?\b/],
    // fédération/ligue/comité (organisation) + loisir non-entraînement.
    suspicious: [
      w("federation"),
      w("ligue"),
      w("comite"),
      /laser game/,
      /centre de loisirs/,
      /base de loisirs/,
      /office municipal/,
    ],
  },
  football: {
    positive: [w("football"), w("foot"), w("stade"), w("stades")],
    contradiction: C_BALLON,
    suspicious: [],
  },
  basketball: {
    positive: [w("basket"), w("basketball"), w("playground"), w("gymnase")],
    contradiction: C_BALLON,
    suspicious: [],
  },
};

export type SportSignal = "positive" | "neutral" | "suspicious" | "contradiction";

/**
 * Classe le NOM d'une venue vis-à-vis d'un sport. Priorité (la plus forte
 * d'abord) : contradiction → positive → suspicious → neutral. La contradiction
 * prime sur le positif pour préserver l'exclusion #553 (« salle de musculation
 * du tennis club » contredit le tennis même s'il mentionne « tennis »).
 */
export function getSportSignal(name: string | null | undefined, sportSlug: string): SportSignal {
  if (!name || !name.trim()) return "neutral";
  const n = normalizeName(name);
  if (GENERIC_MULTISPORT.some((re) => re.test(n))) return "contradiction";
  const rule = SPORT_RULES[sportSlug];
  if (!rule) return "neutral"; // sport sans règle dédiée : seul le générique compte
  if (rule.contradiction.some((re) => re.test(n))) return "contradiction";
  if (rule.positive.some((re) => re.test(n))) return "positive";
  if (rule.suspicious.some((re) => re.test(n))) return "suspicious";
  return "neutral";
}

/**
 * true si le nom contredit le sport (générique multi-sport OU équipement
 * clairement autre) → à EXCLURE des listes SEO mono-sport. N'inclut PAS les
 * `suspicious` (eux ne sont que rétrogradés). Remplace l'ancien cœur de #553.
 */
export function isSportContradiction(name: string | null | undefined, sportSlug: string): boolean {
  return getSportSignal(name, sportSlug) === "contradiction";
}

/**
 * Score de signal numérique, fourni pour l'intégration au ranking (#637) :
 * positif boostant, suspect/contradiction pénalisant. Déterministe et borné.
 */
export function sportSignalScore(name: string | null | undefined, sportSlug: string): number {
  switch (getSportSignal(name, sportSlug)) {
    case "positive":
      return 15;
    case "suspicious":
      return -20;
    case "contradiction":
      return -40;
    default:
      return 0;
  }
}

/** Rang de tri (0 = meilleur) par signal — utilisé pour reléguer les douteux. */
export function sportSignalRank(name: string | null | undefined, sportSlug: string): number {
  switch (getSportSignal(name, sportSlug)) {
    case "positive":
      return 0;
    case "neutral":
      return 1;
    case "suspicious":
      return 2;
    case "contradiction":
      return 3;
  }
}
