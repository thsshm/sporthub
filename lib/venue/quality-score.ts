import { sportSignalScore } from "@/lib/venue/sport-rules";

/**
 * Score de qualité d'une venue (#464).
 *
 * Beaucoup de venues importées d'OSM/Overture sont des entrées « squelette » :
 * un nom + des coordonnées, sans adresse, contact, ni contenu. Indexer ces
 * pages dilue le crawl budget et nuit à la perception de qualité du domaine.
 *
 * On calcule un score de complétude/confiance 0–100 à partir des signaux
 * **déjà présents** sur la venue (aucune requête, aucune mutation). Le score
 * sert à décider du `noindex` des fiches trop pauvres (cf. `buildVenueMetadata`).
 *
 * NB : la détection des venues « douteuses » par signaux data (courts absurdes,
 * mauvaise classification, doublons — #463) est complémentaire et viendra
 * abaisser le score en amont via le pipeline ; ici on ne juge que la complétude.
 */

/** Sous-ensemble structurel de `VenueDetail` nécessaire au scoring. */
export type ScorableVenue = {
  /** Nom affiché — sert à la pénalité « organisation, pas une installation » (#588). */
  name?: string | null;
  address?: string | null;
  city_id?: string | null;
  city_name?: string | null;
  website_url?: string | null;
  phone?: string | null;
  description?: string | null;
  primary_sport_slug?: string | null;
  claim_status?: "unclaimed" | "pending" | "verified" | null;
  enrichments?: {
    photo_url?: string;
    description?: string;
    google_rating?: number;
    google_rating_count?: number;
  } | null;
};

/**
 * Poids par signal — somme = 100. Un signal « présent » rapporte son poids ;
 * absent, 0. Ordre = identité/localisation → contact → contenu → confiance.
 */
const WEIGHTS = {
  address: 20,
  city: 10,
  website: 15,
  phone: 10,
  description: 12,
  photo: 10,
  rating: 8,
  verified: 10,
  sport: 5,
} as const;

/**
 * En-dessous de ce score, la fiche est jugée trop pauvre → `noindex`.
 * 25 = il faut une adresse (20) plus au moins un autre signal, OU plusieurs
 * signaux moyens. Une entrée « nom + coordonnées » seule tombe à 0.
 */
export const LOW_QUALITY_THRESHOLD = 25;

function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** minuscule + sans accents — comparaison de mots robuste (même approche que
 * scripts/etl/cleaning.py). */
function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Termes signalant une ORGANISATION (fédération, instance, administration) et
 * non une installation où s'entraîner (#588 — pages gym polluées par
 * « Ligue … de gymnastique », « Comité départemental … », districts, etc.).
 * Conservateur : termes peu ambigus uniquement, matchés à frontière de mot.
 */
const ORG_SIGNALS = [
  "federation",
  "ligue",
  "comite",
  "district",
  "office municipal",
  "office des sports",
  "conseil departemental",
  "conseil regional",
  "conseil general",
  "direction departementale",
  "communaute de communes",
  "syndicat intercommunal",
  "ufolep",
  "usep",
] as const;

/**
 * Termes d'INSTALLATION qui neutralisent la pénalité org : « Salle de la
 * Ligue », « District Fitness » (enseigne)… sont de vrais lieux d'entraînement.
 */
const FACILITY_SIGNALS = [
  "salle",
  "gymnase",
  "studio",
  "dojo",
  "halle",
  "complexe",
  "stade",
  "court",
  "courts",
  "terrain",
  "piscine",
  "fitness",
  "gym",
  "musculation",
  "crossfit",
] as const;

const wordRe = (term: string) =>
  new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`);
const ORG_PATTERNS = ORG_SIGNALS.map(wordRe);
const FACILITY_PATTERNS = FACILITY_SIGNALS.map(wordRe);

/**
 * true si le nom désigne une organisation/instance (fédération, ligue,
 * comité…) SANS signal d'installation. Ces entités ne sont pas des lieux où
 * s'entraîner → à déprioriser des listes SEO (#588).
 */
export function isOrganizationName(name: string | null | undefined): boolean {
  if (!hasText(name)) return false;
  const n = normName(name as string);
  if (!ORG_PATTERNS.some((p) => p.test(n))) return false;
  return !FACILITY_PATTERNS.some((p) => p.test(n));
}

/** Pénalité appliquée au score quand le nom signale une organisation (#588).
 * Assez forte pour faire passer un squelette org sous LOW_QUALITY_THRESHOLD
 * (exclu des listes), tout en laissant visible — mais dépriorisée — une fiche
 * org très complète (adresse + contact + contenu). */
export const ORGANIZATION_PENALTY = 30;

/** Score de qualité 0–100 (entier). */
export function venueQualityScore(venue: ScorableVenue): number {
  const e = venue.enrichments ?? undefined;
  let score = 0;

  if (hasText(venue.address)) score += WEIGHTS.address;
  if (venue.city_id || hasText(venue.city_name)) score += WEIGHTS.city;
  if (hasText(venue.website_url)) score += WEIGHTS.website;
  if (hasText(venue.phone)) score += WEIGHTS.phone;
  if (hasText(venue.description) || hasText(e?.description)) {
    score += WEIGHTS.description;
  }
  if (hasText(e?.photo_url)) score += WEIGHTS.photo;
  if ((e?.google_rating ?? 0) > 0 && (e?.google_rating_count ?? 0) > 0) {
    score += WEIGHTS.rating;
  }
  if (venue.claim_status === "verified") score += WEIGHTS.verified;
  if (hasText(venue.primary_sport_slug)) score += WEIGHTS.sport;

  // Pénalité « organisation, pas une installation » (#588) : les fédérations/
  // ligues/comités descendent dans le ranking (#563) et, squelettes, passent
  // sous le seuil noindex/liste (#464). Jamais sous 0.
  if (isOrganizationName(venue.name)) score -= ORGANIZATION_PENALTY;

  return Math.max(0, Math.min(100, score));
}

/** true si la fiche est trop pauvre pour être indexée. */
export function isLowQualityVenue(venue: ScorableVenue): boolean {
  return venueQualityScore(venue) < LOW_QUALITY_THRESHOLD;
}

/**
 * Score qualité AJUSTÉ POUR UN SPORT (#637) — combine la complétude
 * (`venueQualityScore`, #464) et le signal nom↔sport (`sportSignalScore`, #638).
 * Positif → +15, suspect → −20, contradiction → −40 ; borné 0–100, déterministe.
 *
 * Sert au **ranking** des listes SEO mono-sport (un club « padel » remonte, un
 * « Tennis Club » sans signal padel descend) — PAS à l'exclusion : un lieu
 * multi-sport légitime (présent dans `venue_sport` pour ce sport) reste listé,
 * simplement dépriorisé (garde-fou #637 : démotion avant exclusion). L'exclusion
 * dure reste `isLowQualityVenue` (complétude) + `isSportMismatch` (contradiction).
 */
export function venueQualityScoreForSport(venue: ScorableVenue, sportSlug: string): number {
  const score = venueQualityScore(venue) + sportSignalScore(venue.name, sportSlug);
  return Math.max(0, Math.min(100, score));
}

/**
 * Seuil de « fiche complète » : à partir de ce score, la fiche est assez riche
 * pour porter un badge qualité positif. 60 = typiquement adresse + ville + au
 * moins deux signaux de contact/contenu (ex. site + téléphone + description).
 */
export const HIGH_QUALITY_THRESHOLD = 60;

/** Badge qualité positif à afficher sur la fiche, ou null si aucun. */
export type VenueQualityBadge = "verified" | "complete" | null;

/**
 * Badge qualité POSITIF d'une venue (on n'affiche jamais de badge « négatif ») :
 *  - "verified" : fiche revendiquée et vérifiée par un responsable du lieu ;
 *  - "complete" : score de complétude ≥ HIGH_QUALITY_THRESHOLD ;
 *  - null       : rien à afficher (on ne stigmatise pas les fiches pauvres).
 */
export function venueQualityBadge(venue: ScorableVenue): VenueQualityBadge {
  if (venue.claim_status === "verified") return "verified";
  if (venueQualityScore(venue) >= HIGH_QUALITY_THRESHOLD) return "complete";
  return null;
}
