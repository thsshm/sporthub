/**
 * Détection nom ↔ sport pour les listes SEO mono-sport.
 *
 * Depuis #638, le cœur (signaux positifs/négatifs par sport) vit dans
 * `sport-rules.ts` — carte configurable, facile à éditer. Ce module garde l'API
 * historique (#553) consommée par les pages sport / sport×ville :
 * - `isSportMismatch` : EXCLUSION dure (générique multi-sport OU équipement
 *   clairement autre = `contradiction`). N'inclut pas les `suspicious`.
 * - `sinkMismatches`  : RÉTROGRADATION (tri stable) — promeut les signaux
 *   positifs, relègue suspects puis contradictions en fin de liste. Démotion
 *   avant exclusion (garde-fou #638) : un suspect reste listé, juste en bas.
 *
 * Logique PURE → testable sans DB.
 */
import { isSportContradiction, sportSignalRank } from "@/lib/venue/sport-rules";

/**
 * true si le nom de la venue contredit le sport de la page → à exclure des
 * listes SEO mono-sport (mais PAS de la carte ni de sa fiche). Délègue à la
 * carte de règles (#638) ; comportement identique à #553.
 */
export function isSportMismatch(name: string | null | undefined, sportSlug: string): boolean {
  return isSportContradiction(name, sportSlug);
}

/**
 * Trie une liste par pertinence-sport (#638) en tri STABLE : positifs d'abord,
 * puis neutres, puis suspects, puis contradictions. L'ordre relatif au sein de
 * chaque rang est préservé (on respecte le tri qualité amont). Utilisé par le
 * fallback d'affichage des pages thin (#551) et la page sport : la liste reste
 * honnête/complète, les venues douteuses ne sont jamais prioritaires (#553).
 */
export function sinkMismatches<T extends { name: string }>(venues: T[], sportSlug: string): T[] {
  return venues
    .map((v, i) => ({ v, i, rank: sportSignalRank(v.name, sportSlug) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((d) => d.v);
}
