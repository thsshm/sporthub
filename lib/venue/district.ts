/**
 * Arrondissement (#703) pour les grandes villes françaises à arrondissements
 * (Paris, Lyon, Marseille). Dérivé du CODE POSTAL présent dans l'adresse —
 * JAMAIS fabriqué (contrainte #703 : pas de code postal d'arrondissement
 * cohérent → on n'affiche rien). Pur, déterministe, testable.
 *
 * But : distinguer deux lieux homonymes d'une même grande ville sur les cards
 * SEO (« Basic-Fit Paris » 11e vs 15e) — la ville seule (« Paris (FR) ») ne
 * suffit pas (#703, #642).
 */

// Villes à arrondissements : plages [cpMin, cpMax, base] valides. L'arrondissement
// = cp - base. Plusieurs plages possibles (Paris : 75001-75020 ET 751xx pour le
// 16e). On reste sur les plages OFFICIELLES → pas de faux positif sur un CP du
// même département qui ne serait pas un arrondissement (ex. 69100 Villeurbanne).
const ARR_RULES: { city: RegExp; ranges: [number, number, number][] }[] = [
  { city: /^paris$/, ranges: [[75001, 75020, 75000], [75101, 75120, 75100]] },
  { city: /^lyon$/, ranges: [[69001, 69009, 69000]] },
  { city: /^marseille$/, ranges: [[13001, 13016, 13000]] },
];

function normalizeCity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ordinalFr(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/**
 * Renvoie l'arrondissement formaté (« 11e », « 1er ») si `address` contient un
 * code postal d'arrondissement cohérent avec `cityName`, sinon `null`.
 * Ne fabrique jamais : pas d'adresse, pas de CP reconnu, ou ville sans
 * arrondissement → `null`.
 */
export function getArrondissement(
  address: string | null | undefined,
  cityName: string | null | undefined,
): string | null {
  if (!address || !cityName) return null;
  const rule = ARR_RULES.find((r) => r.city.test(normalizeCity(cityName)));
  if (!rule) return null;
  for (const m of address.matchAll(/\b(\d{5})\b/g)) {
    const cp = Number(m[1]);
    for (const [lo, hi, base] of rule.ranges) {
      if (cp >= lo && cp <= hi) return ordinalFr(cp - base);
    }
  }
  return null;
}
