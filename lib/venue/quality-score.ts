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

  return Math.min(100, score);
}

/** true si la fiche est trop pauvre pour être indexée. */
export function isLowQualityVenue(venue: ScorableVenue): boolean {
  return venueQualityScore(venue) < LOW_QUALITY_THRESHOLD;
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
