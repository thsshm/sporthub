/**
 * Détection nom ↔ sport contradictoires pour les listes SEO (#553).
 *
 * Complément FRONTEND du nettoyage ETL (#584/#591) : l'ETL reclasse par nom,
 * mais ne peut pas trancher quand le nom contient À LA FOIS un terme d'un
 * autre équipement ET le sport (ex. « salle de musculation du tennis club du
 * fort » — c'est la salle de muscu DU club, pas un court). Sur une page SEO
 * mono-sport, ces venues cassent la confiance → on les exclut de la LISTE
 * (elles restent sur la carte, exhaustive, et sur leur fiche).
 *
 * Logique PURE (normalisation + listes de termes) → testable sans DB.
 * Frontières de mot sur texte normalisé (minuscules, sans accents) — cf.
 * cicatrice #487/#591 : jamais de substring nu (« Pétanque » ≠ « tank »).
 */

/** Normalise pour le matching : minuscules + accents retirés. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Termes génériques « équipement multi-activités » : suspects sur TOUTE page
 * mono-sport (l'équipement n'est pas dédié au sport de la page).
 * Préfixes volontaires : `polyvalent` matche « polyvalente », `multisport`
 * matche « multisports ».
 */
const GENERIC_MISMATCH = [/\bmultisports?\b/, /\bomnisports?\b/, /\bpolyvalente?s?\b/];

/**
 * Termes contredisant un sport donné : la présence du terme dans le NOM
 * signale un autre équipement, même si le nom mentionne aussi le sport.
 * Listes volontairement courtes et factuelles (exemples réels de l'audit
 * #553) — élargir au cas par cas, jamais en masse (risque faux positifs).
 */
const SPORT_MISMATCH: Record<string, RegExp[]> = {
  tennis: [
    /\bpiscines?\b/,
    /\bmusculation\b/,
    /\bfitness\b/,
    /\bnatation\b/,
    /\bboulodromes?\b/,
    /\bpatinoires?\b/,
  ],
  padel: [
    /\bpiscines?\b/,
    /\bmusculation\b/,
    /\bfitness\b/,
    /\bnatation\b/,
    /\bboulodromes?\b/,
    /\bpatinoires?\b/,
  ],
  // gym : musculation/fitness sont POSITIFS ici — seuls les équipements
  // clairement autres contredisent.
  gym: [/\bpiscines?\b/, /\bnatation\b/, /\bboulodromes?\b/, /\bpatinoires?\b/],
  football: [
    /\bpiscines?\b/,
    /\bmusculation\b/,
    /\bfitness\b/,
    /\bnatation\b/,
    /\bboulodromes?\b/,
    /\bpatinoires?\b/,
  ],
  basketball: [
    /\bpiscines?\b/,
    /\bmusculation\b/,
    /\bfitness\b/,
    /\bnatation\b/,
    /\bboulodromes?\b/,
    /\bpatinoires?\b/,
  ],
};

/**
 * true si le nom de la venue contredit le sport de la page → à exclure des
 * listes SEO mono-sport (mais PAS de la carte ni de sa fiche).
 *
 * Un sport sans liste dédiée n'applique que les termes génériques
 * (multisport/omnisport/polyvalent).
 */
export function isSportMismatch(
  name: string | null | undefined,
  sportSlug: string,
): boolean {
  if (!name || !name.trim()) return false;
  const n = normalize(name);
  if (GENERIC_MISMATCH.some((re) => re.test(n))) return true;
  const specific = SPORT_MISMATCH[sportSlug];
  return specific ? specific.some((re) => re.test(n)) : false;
}

/**
 * Trie une liste pour reléguer les noms contradictoires EN FIN (tri stable,
 * ordre relatif préservé dans chaque groupe). Utilisé par le fallback
 * d'affichage des pages thin (#551) : on garde la liste honnête/complète,
 * mais les venues douteuses ne sont jamais les « résultats prioritaires »
 * (#553).
 */
export function sinkMismatches<T extends { name: string }>(
  venues: T[],
  sportSlug: string,
): T[] {
  const ok: T[] = [];
  const doubtful: T[] = [];
  for (const v of venues) {
    (isSportMismatch(v.name, sportSlug) ? doubtful : ok).push(v);
  }
  return [...ok, ...doubtful];
}
