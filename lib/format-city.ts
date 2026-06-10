/**
 * Normalisation d'affichage des noms de ville (#559).
 *
 * Les sources publiques (RES France, OSM) livrent parfois des noms 100 %
 * MAJUSCULES (« PARIS », « AIX-EN-PROVENCE ») qui donnent une impression de
 * donnée brute sur la home et les fiches. `formatCityName` les passe en
 * casse titre, en gardant :
 *   - les noms déjà en casse mixte intacts (« Saint-Étienne », scripts non
 *     latins) — on fait confiance à la source ;
 *   - les acronymes courts tout en majuscules (« NY ») ;
 *   - les particules françaises en minuscule sauf en tête (« Aix-en-Provence »,
 *     « L'Haÿ-les-Roses »).
 *
 * Purement présentationnel : ne modifie JAMAIS la donnée stockée ni les slugs.
 */

// Particules qui restent en minuscule au milieu d'un nom (français + quelques
// anglaises pour les villes étrangères).
const LOWER_PARTICLES: ReadonlySet<string> = new Set([
  "a",
  "au",
  "aux",
  "de",
  "des",
  "du",
  "en",
  "et",
  "la",
  "le",
  "les",
  "lès",
  "sous",
  "sur",
  "the",
  "of",
  "on",
  "upon",
]);

export function formatCityName(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "";
  // Déjà en casse mixte (ou script non latin sans notion de casse) → on garde.
  if (s !== s.toUpperCase()) return s;
  // Acronyme court entièrement en majuscules (« NY », « LA ») → on garde.
  if (/^[\p{Lu}]{1,3}$/u.test(s)) return s;

  // On capitalise la 1ʳᵉ lettre de chaque mot (séparé par espace, tiret, slash
  // ou apostrophe). `sep` est le séparateur capturé (vide en tête de chaîne).
  return s
    .toLowerCase()
    .replace(
      /(^|[\s\-/'’])(\p{L})(\p{L}*)/gu,
      (_match, sep: string, first: string, rest: string) => {
        const word = first + rest;
        const isApostrophe = sep === "'" || sep === "’";
        // Particule au milieu (hors apostrophe, ex. « L'Haÿ ») → minuscule.
        if (sep !== "" && !isApostrophe && LOWER_PARTICLES.has(word)) {
          return sep + word;
        }
        return sep + first.toUpperCase() + rest;
      }
    );
}
