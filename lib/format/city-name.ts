/**
 * Normalise l'affichage d'un nom de ville (#559). Certaines villes arrivent
 * TOUT EN MAJUSCULES des sources (« PARIS », « AIX-EN-PROVENCE ») → moche dans
 * les titres/H1. On les remet en casse de titre française.
 *
 * CONSERVATEUR : on ne touche QU'aux noms entièrement en majuscules. Un nom déjà
 * correctement casé (« Le Mans », « Saint-Étienne ») est laissé tel quel → aucun
 * risque de dégrader une donnée propre.
 */

// Particules françaises laissées en minuscules (sauf en 1ʳᵉ position).
const LOWER_PARTICLES = new Set([
  "de", "du", "des", "la", "le", "les", "l", "d",
  "en", "sur", "sous", "aux", "au", "et", "à", "lès", "les",
]);

/** Vrai si la chaîne contient des lettres et AUCUNE minuscule. */
function isAllCaps(s: string): boolean {
  return s !== s.toLowerCase() && s === s.toUpperCase();
}

function capitalizeWord(word: string, isFirst: boolean): string {
  const lower = word.toLocaleLowerCase("fr");
  // Ordinaux d'arrondissement : « 3e », « 1er », « 2nd » → minuscules.
  if (/^\d+(?:er|re|e|ème|nd|nde)$/.test(lower)) return lower;
  if (!isFirst && LOWER_PARTICLES.has(lower)) return lower;
  return lower.charAt(0).toLocaleUpperCase("fr") + lower.slice(1);
}

export function formatCityName(name: string | null | undefined): string {
  if (!name) return "";
  if (!isAllCaps(name)) return name; // déjà casé → on ne touche pas
  // Traite chaque mot, en respectant les traits d'union (« Aix-en-Provence »).
  // On garde une notion de « tout premier mot » globale pour ne pas mettre une
  // particule initiale en minuscule.
  let globalIndex = 0;
  return name
    .split(" ")
    .map((spaceWord) => {
      const out = spaceWord
        .split("-")
        .map((part) => {
          const res = capitalizeWord(part, globalIndex === 0);
          globalIndex += 1;
          return res;
        })
        .join("-");
      return out;
    })
    .join(" ");
}
