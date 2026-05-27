/**
 * Types générés depuis le schéma Supabase.
 *
 * Pour régénérer à partir de votre projet Supabase :
 *   pnpm supabase gen types typescript --project-id <votre-project-id> > lib/supabase/types.ts
 *
 * Ou avec la Supabase CLI locale :
 *   pnpm supabase gen types typescript --local > lib/supabase/types.ts
 *
 * Pour l'instant ce fichier est un placeholder permettant au code de compiler.
 * Dès que le schéma 0001 est appliqué, régénérer et remplacer le contenu.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

// Types utilitaires pour les tables principales — à affiner après génération complète

export type Venue = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address: string | null;
  city_id: string | null;
  postal_code: string | null;
  country_code: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  family_slug: string;
  primary_sport_slug: string | null;
  is_indoor: boolean | null;
  has_lighting: boolean | null;
  is_wheelchair_accessible: boolean | null;
  courts_count: number | null;
  capacity: number | null;
  fee_required: boolean | null;
  price_range: string | null;
  source: string;
  external_id: string | null;
  enrichments: VenueEnrichments;
  claimed_by: string | null;
  claim_status: "unclaimed" | "pending" | "verified";
  is_published: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VenueEnrichments = {
  wikipedia_url?: string;
  wikipedia_label?: string;
  photo_url?: string;
  google_place_id?: string;
  google_rating?: number;
  google_rating_count?: number;
  google_cached_at?: string;
  raw_tags?: Record<string, string>;
  v1_club_id?: string;
};

export type Sport = {
  slug: string;
  name_fr: string;
  name_en: string;
  family_slug: string;
  emoji: string | null;
  color: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type City = {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  lat: number;
  lon: number;
  population: number | null;
  is_featured: boolean;
  created_at: string;
};

export type Country = {
  code: string;
  name_fr: string;
  name_en: string;
  emoji_flag: string | null;
  created_at: string;
};

export type Amenity = {
  slug: string;
  name_fr: string;
  name_en: string;
  emoji: string | null;
  category: string | null;
  created_at: string;
};

export type VenueSport = {
  venue_id: string;
  sport_slug: string;
  is_primary: boolean;
  courts_count: number | null;
  surface: string | null;
};

export type VenueAmenity = {
  venue_id: string;
  amenity_slug: string;
  detail: string | null;
};

export type BookingLink = {
  id: string;
  venue_id: string;
  partner: string;
  url: string;
  sport_slug: string | null;
  is_active: boolean;
  created_at: string;
};

// Type étendu pour la page détail venue — résultat d'un join
export type VenueDetail = Venue & {
  city_name?: string;
  country_name?: string;
  sports?: (VenueSport & { sport?: Sport })[];
  amenities?: (VenueAmenity & { amenity?: Amenity })[];
  booking_links?: BookingLink[];
};

// Type léger pour la carte et les listes
export type VenuePin = Pick<Venue, "id" | "slug" | "name" | "lat" | "lon" | "family_slug" | "primary_sport_slug">;
