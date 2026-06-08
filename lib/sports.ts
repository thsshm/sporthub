/**
 * Catalogue statique de tous les sports SportHub.
 * Miroir du seed SQL dans 0001_initial_schema.sql §sport.
 * Permet à l'UI de fonctionner sans requête DB pour les données de référence.
 */

export type SportDef = {
  slug: string;
  name_fr: string;
  name_en: string;
  family_slug: string;
  emoji: string;
  color: string;
  position: number;
};

export const SPORTS: SportDef[] = [
  // Raquette
  { slug: "tennis", name_fr: "Tennis", name_en: "Tennis", family_slug: "raquette", emoji: "🎾", color: "#2d7a3e", position: 1 },
  { slug: "padel", name_fr: "Padel", name_en: "Padel", family_slug: "raquette", emoji: "🥎", color: "#2d7a3e", position: 2 },
  { slug: "table_tennis", name_fr: "Ping-pong", name_en: "Table tennis", family_slug: "raquette", emoji: "🏓", color: "#2d7a3e", position: 3 },
  { slug: "badminton", name_fr: "Badminton", name_en: "Badminton", family_slug: "raquette", emoji: "🏸", color: "#2d7a3e", position: 4 },
  { slug: "squash", name_fr: "Squash", name_en: "Squash", family_slug: "raquette", emoji: "🎾", color: "#2d7a3e", position: 5 },
  // Ballon
  { slug: "football", name_fr: "Football", name_en: "Football", family_slug: "ballon", emoji: "⚽", color: "#b45309", position: 1 },
  { slug: "basketball", name_fr: "Basket", name_en: "Basketball", family_slug: "ballon", emoji: "🏀", color: "#b45309", position: 2 },
  { slug: "handball", name_fr: "Handball", name_en: "Handball", family_slug: "ballon", emoji: "🤾", color: "#b45309", position: 3 },
  { slug: "volleyball", name_fr: "Volley", name_en: "Volleyball", family_slug: "ballon", emoji: "🏐", color: "#b45309", position: 4 },
  { slug: "rugby", name_fr: "Rugby", name_en: "Rugby", family_slug: "ballon", emoji: "🏉", color: "#b45309", position: 5 },
  // Fitness
  { slug: "gym", name_fr: "Salle de sport", name_en: "Gym", family_slug: "fitness", emoji: "🏋️", color: "#7c3aed", position: 1 },
  { slug: "crossfit", name_fr: "CrossFit", name_en: "CrossFit", family_slug: "fitness", emoji: "💪", color: "#7c3aed", position: 2 },
  { slug: "hyrox", name_fr: "Hyrox", name_en: "Hyrox", family_slug: "fitness", emoji: "🔥", color: "#7c3aed", position: 3 },
  { slug: "pilates", name_fr: "Pilates", name_en: "Pilates", family_slug: "fitness", emoji: "🤸", color: "#7c3aed", position: 4 },
  { slug: "dance", name_fr: "Danse", name_en: "Dance", family_slug: "fitness", emoji: "💃", color: "#7c3aed", position: 5 },
  // Yoga / Bien-être
  { slug: "yoga", name_fr: "Yoga", name_en: "Yoga", family_slug: "yoga", emoji: "🧘", color: "#db2777", position: 1 },
  { slug: "meditation", name_fr: "Méditation", name_en: "Meditation", family_slug: "yoga", emoji: "🕯️", color: "#db2777", position: 2 },
  { slug: "spa", name_fr: "Spa", name_en: "Spa", family_slug: "yoga", emoji: "💆", color: "#db2777", position: 3 },
  { slug: "sauna", name_fr: "Sauna", name_en: "Sauna", family_slug: "yoga", emoji: "♨️", color: "#db2777", position: 4 },
  { slug: "hammam", name_fr: "Hammam", name_en: "Hammam", family_slug: "yoga", emoji: "🛁", color: "#db2777", position: 5 },
  // Combat
  { slug: "boxing", name_fr: "Boxe", name_en: "Boxing", family_slug: "combat", emoji: "🥊", color: "#b91c1c", position: 1 },
  { slug: "judo", name_fr: "Judo", name_en: "Judo", family_slug: "combat", emoji: "🥋", color: "#b91c1c", position: 2 },
  { slug: "karate", name_fr: "Karaté", name_en: "Karate", family_slug: "combat", emoji: "🥋", color: "#b91c1c", position: 3 },
  { slug: "mma", name_fr: "MMA", name_en: "MMA", family_slug: "combat", emoji: "🤼", color: "#b91c1c", position: 4 },
  { slug: "bjj", name_fr: "BJJ", name_en: "BJJ", family_slug: "combat", emoji: "🥋", color: "#b91c1c", position: 5 },
  // Boules
  { slug: "petanque", name_fr: "Pétanque", name_en: "Pétanque", family_slug: "boules", emoji: "🟢", color: "#ca8a04", position: 1 },
  { slug: "boules", name_fr: "Boules lyonnaises", name_en: "Lyonnaises", family_slug: "boules", emoji: "⚪", color: "#ca8a04", position: 2 },
  // Baignade
  { slug: "beach", name_fr: "Plage", name_en: "Beach", family_slug: "baignade", emoji: "🏖️", color: "#0891b2", position: 1 },
  { slug: "pool", name_fr: "Piscine", name_en: "Pool", family_slug: "baignade", emoji: "🏊", color: "#0891b2", position: 2 },
  // Glisse
  { slug: "surf", name_fr: "Surf", name_en: "Surf", family_slug: "glisse", emoji: "🏄", color: "#0ea5e9", position: 1 },
  { slug: "kitesurf", name_fr: "Kitesurf", name_en: "Kitesurfing", family_slug: "glisse", emoji: "🪁", color: "#0ea5e9", position: 2 },
  { slug: "windsurf", name_fr: "Windsurf", name_en: "Windsurfing", family_slug: "glisse", emoji: "🌬️", color: "#0ea5e9", position: 3 },
  { slug: "sup", name_fr: "SUP", name_en: "SUP", family_slug: "glisse", emoji: "🚣", color: "#0ea5e9", position: 4 },
  { slug: "wakeboard", name_fr: "Wakeboard", name_en: "Wakeboard", family_slug: "glisse", emoji: "🌊", color: "#0ea5e9", position: 5 },
  // Nautique
  { slug: "marina", name_fr: "Marina", name_en: "Marina", family_slug: "nautique", emoji: "⛵", color: "#1e40af", position: 1 },
  { slug: "diving", name_fr: "Plongée", name_en: "Diving", family_slug: "nautique", emoji: "🤿", color: "#1e40af", position: 2 },
  { slug: "lighthouse", name_fr: "Phare", name_en: "Lighthouse", family_slug: "nautique", emoji: "🗼", color: "#1e40af", position: 3 },
  // Snow
  { slug: "skiing", name_fr: "Ski alpin", name_en: "Skiing", family_slug: "snow", emoji: "⛷️", color: "#6366f1", position: 1 },
  { slug: "snowboarding", name_fr: "Snowboard", name_en: "Snowboarding", family_slug: "snow", emoji: "🏂", color: "#6366f1", position: 2 },
  { slug: "cross_country", name_fr: "Ski de fond", name_en: "Cross-country", family_slug: "snow", emoji: "🎿", color: "#6366f1", position: 3 },
  // Hike / Plein air & endurance
  { slug: "trail", name_fr: "Sentier", name_en: "Trail", family_slug: "hike", emoji: "🥾", color: "#16a34a", position: 1 },
  { slug: "long_trail", name_fr: "GR", name_en: "Long trail", family_slug: "hike", emoji: "🚶", color: "#16a34a", position: 2 },
  { slug: "trailrun", name_fr: "Trail running", name_en: "Trail run", family_slug: "hike", emoji: "🏃", color: "#16a34a", position: 3 },
  { slug: "running", name_fr: "Course", name_en: "Running", family_slug: "hike", emoji: "👟", color: "#16a34a", position: 4 },
  { slug: "cycling", name_fr: "Vélo", name_en: "Cycling", family_slug: "hike", emoji: "🚴", color: "#16a34a", position: 5 },
  { slug: "mtb", name_fr: "VTT", name_en: "MTB", family_slug: "hike", emoji: "🚵", color: "#16a34a", position: 6 },
  // Escalade rattachée à la famille hike/Outdoor (#470 ; ex-famille escalade #312)
  { slug: "climbing_indoor", name_fr: "Escalade", name_en: "Climbing", family_slug: "hike", emoji: "🧗", color: "#16a34a", position: 7 },
  // Plus
  { slug: "golf", name_fr: "Golf", name_en: "Golf", family_slug: "plus", emoji: "⛳", color: "#6b7280", position: 1 },
  { slug: "equestrian", name_fr: "Équitation", name_en: "Equestrian", family_slug: "plus", emoji: "🐎", color: "#6b7280", position: 2 },
  { slug: "archery", name_fr: "Tir à l'arc", name_en: "Archery", family_slug: "plus", emoji: "🏹", color: "#6b7280", position: 3 },
  { slug: "paragliding", name_fr: "Parapente", name_en: "Paragliding", family_slug: "plus", emoji: "🪂", color: "#6b7280", position: 5 },
  // Retraites
  { slug: "yoga_retreat", name_fr: "Retraite yoga", name_en: "Yoga retreat", family_slug: "retraites", emoji: "🧘", color: "#be185d", position: 1 },
  { slug: "surf_camp", name_fr: "Surf camp", name_en: "Surf camp", family_slug: "retraites", emoji: "🏄", color: "#be185d", position: 2 },
  { slug: "wellness_retreat", name_fr: "Bien-être", name_en: "Wellness", family_slug: "retraites", emoji: "💆", color: "#be185d", position: 3 },
];

/** Accès rapide par slug */
export const SPORTS_BY_SLUG = Object.fromEntries(SPORTS.map((s) => [s.slug, s]));

/**
 * Emoji du sport (le même que sur l'accueil / les pages sport) pour les pins de
 * la carte. Retourne `null` si le slug n'est pas un sport curé (ex. `spa`,
 * `dance`, ou `null` en base) → le call site fait alors un fallback sur l'emoji
 * de la famille (`getFamilyEmoji`). On garde ainsi une icône sur CHAQUE pin.
 */
export function getSportEmoji(sportSlug: string | null | undefined): string | null {
  if (!sportSlug) return null;
  return SPORTS_BY_SLUG[sportSlug]?.emoji ?? null;
}

/** Sports groupés par famille */
export const SPORTS_BY_FAMILY = SPORTS.reduce<Record<string, SportDef[]>>((acc, sport) => {
  if (!acc[sport.family_slug]) acc[sport.family_slug] = [];
  acc[sport.family_slug].push(sport);
  return acc;
}, {});

/** Liste des slugs de sports principaux (pour generateStaticParams) */
export const MAIN_SPORT_SLUGS = [
  "tennis", "padel", "football", "basketball", "gym",
  "yoga", "surf", "skiing", "running", "petanque",
];
