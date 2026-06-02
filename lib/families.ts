/**
 * Données statiques des 14 familles SportHub.
 * Source de vérité pour l'UI — évite de dépendre de Supabase pour le rendu initial.
 * Doit rester en sync avec la table `sport` seedée dans 0001_initial_schema.sql.
 *
 * Note: les slugs internes (ex: "yoga") diffèrent parfois du display name ("Bien-être")
 * — cf. CLAUDE.md §Mapping famille interne.
 */

export type Family = {
  slug: string;
  name_fr: string;
  name_en: string;
  emoji: string;
  color: string;
  sports: string[]; // slugs des sports principaux de cette famille
};

export const FAMILIES: Family[] = [
  {
    slug: "raquette",
    name_fr: "Raquette",
    name_en: "Racket sports",
    emoji: "🎾",
    color: "#2d7a3e",
    sports: ["tennis", "padel", "table_tennis", "badminton", "squash"],
  },
  {
    slug: "ballon",
    name_fr: "Ballon",
    name_en: "Ball sports",
    emoji: "⚽",
    color: "#b45309",
    sports: ["football", "basketball", "handball", "volleyball", "rugby"],
  },
  {
    slug: "fitness",
    name_fr: "Fitness",
    name_en: "Fitness",
    emoji: "🏋️",
    color: "#7c3aed",
    sports: ["gym", "crossfit", "hyrox", "pilates", "dance"],
  },
  {
    slug: "combat",
    name_fr: "Combat",
    name_en: "Combat",
    emoji: "🥊",
    color: "#b91c1c",
    sports: ["boxing", "judo", "karate", "mma", "bjj"],
  },
  {
    // Slug data "yoga" = "Bien-être" côté UI — héritage V1, ne pas renommer
    slug: "yoga",
    name_fr: "Bien-être",
    name_en: "Wellness",
    emoji: "🧘",
    color: "#db2777",
    sports: ["yoga", "meditation", "spa", "sauna", "hammam"],
  },
  {
    slug: "baignade",
    name_fr: "Baignade",
    name_en: "Swimming",
    emoji: "🏊",
    color: "#0891b2",
    sports: ["beach", "pool"],
  },
  {
    slug: "boules",
    name_fr: "Boules",
    name_en: "Boules",
    emoji: "🟢",
    color: "#ca8a04",
    sports: ["petanque", "boules"],
  },
  {
    slug: "nautique",
    name_fr: "Nautique",
    name_en: "Nautical",
    emoji: "⛵",
    color: "#1e40af",
    sports: ["marina", "diving", "lighthouse"],
  },
  {
    slug: "glisse",
    name_fr: "Glisse",
    name_en: "Board sports",
    emoji: "🏄",
    color: "#0ea5e9",
    sports: ["surf", "kitesurf", "windsurf", "sup", "wakeboard"],
  },
  {
    slug: "snow",
    name_fr: "Sport d'hiver",
    name_en: "Winter sports",
    emoji: "⛷️",
    color: "#6366f1",
    sports: ["skiing", "snowboarding", "cross_country"],
  },
  {
    // Slug "hike" = "Plein air & endurance" côté UI — héritage V1
    slug: "hike",
    name_fr: "Plein air & endurance",
    name_en: "Outdoor & endurance",
    emoji: "🥾",
    color: "#16a34a",
    sports: ["trail", "long_trail", "trailrun", "running", "cycling", "mtb"],
  },
  {
    // Famille ajoutée au palier 2 de #312 : l'escalade/bloc (627 spots V1 sous
    // 'autre') n'avait pas de famille dédiée et tombait dans 'plus'.
    slug: "escalade",
    name_fr: "Escalade",
    name_en: "Climbing",
    emoji: "🧗",
    color: "#ea580c",
    sports: ["climbing_indoor"],
  },
  {
    slug: "retraites",
    name_fr: "Retraites & camps",
    name_en: "Retreats & camps",
    emoji: "🌿",
    color: "#be185d",
    sports: ["yoga_retreat", "surf_camp", "wellness_retreat"],
  },
  {
    slug: "plus",
    name_fr: "Plus de sports",
    name_en: "More sports",
    emoji: "⛳",
    color: "#6b7280",
    sports: ["golf", "equestrian", "archery", "paragliding"],
  },
];

/** Accès rapide par slug */
export const FAMILIES_BY_SLUG = Object.fromEntries(FAMILIES.map((f) => [f.slug, f]));

/** Couleur CSS d'une famille par slug, avec fallback */
export function getFamilyColor(familySlug: string): string {
  return FAMILIES_BY_SLUG[familySlug]?.color ?? "#6b7280";
}

/** Emoji d'une famille par slug */
export function getFamilyEmoji(familySlug: string): string {
  return FAMILIES_BY_SLUG[familySlug]?.emoji ?? "🏟️";
}
