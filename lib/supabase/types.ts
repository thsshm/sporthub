/**
 * Types générés depuis le schéma Supabase (source de vérité).
 *
 * Régénérer après toute migration :
 *   supabase gen types typescript --linked > /tmp/types_gen.ts
 *   python3 scripts/trim-supabase-types.py   # retire le bruit PostGIS
 *
 * Pourquoi le trim : PostGIS installe des centaines de fonctions `st_*` /
 * `geometry_*` + la table `spatial_ref_sys` dans le schéma `public`. Laissées
 * dans le type `Database`, elles font exploser la résolution générique de
 * @supabase/supabase-js (l'inférence retombe sur le schéma vide → `.insert()`
 * attend `never`, `.rpc()` attend `undefined`). On ne garde donc que les 10
 * tables applicatives + la RPC `venues_in_bbox`.
 *
 * Le bloc « généré » va de `export type Json` à `export const Constants`.
 * Les alias métier sous le séparateur sont écrits à la main : ils restent
 * stables à travers les régénérations et exposent `enrichments` typé
 * (VenueEnrichments) là où la DB ne voit qu'un `Json`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      affiliate_click: {
        Row: {
          booking_link_id: string | null;
          created_at: string;
          id: string;
          ip_hash: string | null;
          partner: string;
          partner_slug: string | null;
          referer: string | null;
          source: string | null;
          user_agent: string | null;
          venue_id: string | null;
        };
        Insert: {
          booking_link_id?: string | null;
          created_at?: string;
          id?: string;
          ip_hash?: string | null;
          partner: string;
          partner_slug?: string | null;
          referer?: string | null;
          source?: string | null;
          user_agent?: string | null;
          venue_id?: string | null;
        };
        Update: {
          booking_link_id?: string | null;
          created_at?: string;
          id?: string;
          ip_hash?: string | null;
          partner?: string;
          partner_slug?: string | null;
          referer?: string | null;
          source?: string | null;
          user_agent?: string | null;
          venue_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "affiliate_click_booking_link_id_fkey";
            columns: ["booking_link_id"];
            isOneToOne: false;
            referencedRelation: "booking_link";
            referencedColumns: ["id"];
          },
        ];
      };
      amenity: {
        Row: {
          category: string | null;
          created_at: string;
          emoji: string | null;
          name_en: string;
          name_fr: string;
          slug: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          emoji?: string | null;
          name_en: string;
          name_fr: string;
          slug: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          emoji?: string | null;
          name_en?: string;
          name_fr?: string;
          slug?: string;
        };
        Relationships: [];
      };
      booking_link: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          partner: string;
          sport_slug: string | null;
          url: string;
          venue_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          partner: string;
          sport_slug?: string | null;
          url: string;
          venue_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          partner?: string;
          sport_slug?: string | null;
          url?: string;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_link_sport_slug_fkey";
            columns: ["sport_slug"];
            isOneToOne: false;
            referencedRelation: "sport";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "booking_link_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venue";
            referencedColumns: ["id"];
          },
        ];
      };
      city: {
        Row: {
          country_code: string;
          created_at: string;
          id: string;
          is_featured: boolean | null;
          lat: number;
          lon: number;
          name: string;
          population: number | null;
          slug: string;
        };
        Insert: {
          country_code: string;
          created_at?: string;
          id?: string;
          is_featured?: boolean | null;
          lat: number;
          lon: number;
          name: string;
          population?: number | null;
          slug: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          id?: string;
          is_featured?: boolean | null;
          lat?: number;
          lon?: number;
          name?: string;
          population?: number | null;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "city_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "country";
            referencedColumns: ["code"];
          },
        ];
      };
      claim_request: {
        Row: {
          created_at: string;
          id: string;
          notes: string | null;
          proof_text: string | null;
          proof_url: string | null;
          requester_email: string;
          requester_name: string | null;
          requester_role: string | null;
          requester_user_id: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          venue_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          proof_text?: string | null;
          proof_url?: string | null;
          requester_email: string;
          requester_name?: string | null;
          requester_role?: string | null;
          requester_user_id?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          venue_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          proof_text?: string | null;
          proof_url?: string | null;
          requester_email?: string;
          requester_name?: string | null;
          requester_role?: string | null;
          requester_user_id?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claim_request_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venue";
            referencedColumns: ["id"];
          },
        ];
      };
      // Table `club` — migration 0012, issue #130.
      // Regroupement logique de venues du même établissement.
      club: {
        Row: {
          city_id: string | null;
          country_code: string | null;
          created_at: string;
          family_slug: string;
          id: string;
          lat: number;
          lon: number;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          city_id?: string | null;
          country_code?: string | null;
          created_at?: string;
          family_slug: string;
          id?: string;
          lat: number;
          lon: number;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          city_id?: string | null;
          country_code?: string | null;
          created_at?: string;
          family_slug?: string;
          id?: string;
          lat?: number;
          lon?: number;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "club_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "city";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "club_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "country";
            referencedColumns: ["code"];
          },
        ];
      };
      country: {
        Row: {
          code: string;
          created_at: string;
          emoji_flag: string | null;
          name_en: string;
          name_fr: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          emoji_flag?: string | null;
          name_en: string;
          name_fr: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          emoji_flag?: string | null;
          name_en?: string;
          name_fr?: string;
        };
        Relationships: [];
      };
      partner: {
        Row: {
          affiliate_id: string | null;
          commission_rate: number | null;
          created_at: string;
          is_active: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          affiliate_id?: string | null;
          commission_rate?: number | null;
          created_at?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          affiliate_id?: string | null;
          commission_rate?: number | null;
          created_at?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sport: {
        Row: {
          color: string | null;
          created_at: string;
          emoji: string | null;
          family_slug: string;
          name_en: string;
          name_fr: string;
          position: number | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          emoji?: string | null;
          family_slug: string;
          name_en: string;
          name_fr: string;
          position?: number | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          emoji?: string | null;
          family_slug?: string;
          name_en?: string;
          name_fr?: string;
          position?: number | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_favorite: {
        Row: {
          created_at: string;
          user_id: string;
          venue_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
          venue_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_favorite_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venue";
            referencedColumns: ["id"];
          },
        ];
      };
      venue: {
        Row: {
          address: string | null;
          capacity: number | null;
          city_id: string | null;
          claim_status: string;
          claimed_by: string | null;
          club_id: string | null;
          country_code: string | null;
          courts_count: number | null;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          email: string | null;
          enrichments: Json;
          external_id: string | null;
          family_slug: string;
          fee_required: boolean | null;
          geom: unknown;
          has_lighting: boolean | null;
          id: string;
          is_indoor: boolean | null;
          is_published: boolean;
          is_wheelchair_accessible: boolean | null;
          lat: number;
          lon: number;
          name: string;
          phone: string | null;
          postal_code: string | null;
          price_range: string | null;
          retreat_type: string | null;
          primary_sport_slug: string | null;
          slug: string;
          source: string;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          address?: string | null;
          capacity?: number | null;
          city_id?: string | null;
          claim_status?: string;
          claimed_by?: string | null;
          club_id?: string | null;
          country_code?: string | null;
          courts_count?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          email?: string | null;
          enrichments?: Json;
          external_id?: string | null;
          family_slug: string;
          fee_required?: boolean | null;
          geom?: unknown;
          has_lighting?: boolean | null;
          id?: string;
          is_indoor?: boolean | null;
          is_published?: boolean;
          is_wheelchair_accessible?: boolean | null;
          lat: number;
          lon: number;
          name: string;
          phone?: string | null;
          postal_code?: string | null;
          price_range?: string | null;
          retreat_type?: string | null;
          primary_sport_slug?: string | null;
          slug: string;
          source: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          address?: string | null;
          capacity?: number | null;
          city_id?: string | null;
          claim_status?: string;
          claimed_by?: string | null;
          club_id?: string | null;
          country_code?: string | null;
          courts_count?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          email?: string | null;
          enrichments?: Json;
          external_id?: string | null;
          family_slug?: string;
          fee_required?: boolean | null;
          geom?: unknown;
          has_lighting?: boolean | null;
          id?: string;
          is_indoor?: boolean | null;
          is_published?: boolean;
          is_wheelchair_accessible?: boolean | null;
          lat?: number;
          lon?: number;
          name?: string;
          phone?: string | null;
          postal_code?: string | null;
          price_range?: string | null;
          retreat_type?: string | null;
          primary_sport_slug?: string | null;
          slug?: string;
          source?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "venue_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "city";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "country";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "venue_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "club";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_primary_sport_slug_fkey";
            columns: ["primary_sport_slug"];
            isOneToOne: false;
            referencedRelation: "sport";
            referencedColumns: ["slug"];
          },
        ];
      };
      venue_amenity: {
        Row: {
          amenity_slug: string;
          detail: string | null;
          venue_id: string;
        };
        Insert: {
          amenity_slug: string;
          detail?: string | null;
          venue_id: string;
        };
        Update: {
          amenity_slug?: string;
          detail?: string | null;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venue_amenity_amenity_slug_fkey";
            columns: ["amenity_slug"];
            isOneToOne: false;
            referencedRelation: "amenity";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "venue_amenity_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venue";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_sport: {
        Row: {
          courts_count: number | null;
          is_primary: boolean;
          sport_slug: string;
          surface: string | null;
          venue_id: string;
        };
        Insert: {
          courts_count?: number | null;
          is_primary?: boolean;
          sport_slug: string;
          surface?: string | null;
          venue_id: string;
        };
        Update: {
          courts_count?: number | null;
          is_primary?: boolean;
          sport_slug?: string;
          surface?: string | null;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venue_sport_sport_slug_fkey";
            columns: ["sport_slug"];
            isOneToOne: false;
            referencedRelation: "sport";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "venue_sport_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venue";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      venues_in_bbox: {
        Args: {
          east: number;
          fams?: string[];
          feat?: string[];
          max_results?: number;
          north: number;
          south: number;
          sport?: string;
          west: number;
        };
        Returns: {
          family_slug: string;
          id: string;
          lat: number;
          lon: number;
          name: string;
          primary_sport_slug: string;
          slug: string;
          club_id: string | null;
        }[];
      };
      top_cities_by_venue_count: {
        Args: {
          max_results?: number;
        };
        Returns: {
          id: string;
          slug: string;
          name: string;
          country_code: string;
          count: number;
        }[];
      };
      refresh_top_cities_mv: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      top_discipline_venues: {
        Args: {
          p_sport_slug: string;
          max_results?: number;
        };
        Returns: {
          id: string;
          slug: string;
          name: string;
          address: string | null;
          country_code: string | null;
          courts_count: number | null;
          city_name: string | null;
        }[];
      };
      refresh_disciplines_ranking_mv: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;

/* ────────────────────────────────────────────────────────────────────────
   Alias métier (écrits à la main) — préservés à travers les régénérations.
   ──────────────────────────────────────────────────────────────────────── */

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
  club_id: string | null;
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
  /**
   * Extrait Wikipedia tronqué (≤ 400 chars) — issue #106, importé via
   * `scripts/import_enrichments_v1.py`. Affiché dans popup map + page venue.
   */
  description?: string;
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

// Clic sur un lien de réservation partenaire (cf. migration 0011, issue #111).
// Append-only ; partner/venue_id dénormalisés (copie au moment du clic).
export type AffiliateClick = {
  id: string;
  booking_link_id: string | null;
  partner: string;
  venue_id: string | null;
  source: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  referer: string | null;
  created_at: string;
};

// Référentiel des plateformes partenaires affiliées (cf. migration 0012).
export type Partner = {
  slug: string;
  name: string;
  affiliate_id: string | null;
  commission_rate: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Favoris persistés en DB pour les users authentifiés (cf. migration 0010).
// Les visiteurs non authentifiés gardent leurs favoris en localStorage
// (clé `sporthub-favorites`). Le helper `lib/favorites-sync.ts` migre le
// localStorage vers la DB au moment du login (one-shot).
export type UserFavorite = {
  user_id: string;
  venue_id: string;
  created_at: string;
};

// Club = regroupement logique de venues du même établissement (cf. migration
// 0012, issue #130). 1 pin "club" par établissement au zoom 10-15, avec badge
// du nombre de courts ; au zoom ≥ 16, les venues individuels apparaissent.
export type Club = {
  id: string;
  name: string;
  slug: string;
  family_slug: string;
  city_id: string | null;
  country_code: string | null;
  lat: number;
  lon: number;
  created_at: string;
  updated_at: string;
};

// Type léger pour la carte : sortie de l'endpoint /api/venues/clubs.
// `courts_count` est le COUNT(v.id) des venues rattachées au club.
export type ClubPin = Pick<Club, "id" | "slug" | "name" | "lat" | "lon" | "family_slug"> & {
  courts_count: number;
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
export type VenuePin = Pick<
  Venue,
  "id" | "slug" | "name" | "lat" | "lon" | "family_slug" | "primary_sport_slug"
> & {
  // club_id est exposé par l'API carte (#372) mais n'est pas (encore) fourni par
  // les pins construits côté SSR (pages famille/sport/favoris) → optionnel pour
  // ne pas casser ces sources. À rendre requis quand ces call sites le peupleront.
  club_id?: string | null;
};
