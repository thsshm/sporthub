/**
 * Schéma Zod pour l'édition admin d'une venue.
 *
 * On limite ici aux champs éditables via le formulaire admin (issue #89) :
 *   - name (NOT NULL en DB → required)
 *   - description (TEXT NULL → optionnel)
 *   - website_url (TEXT NULL → URL optionnelle)
 *   - phone (TEXT NULL → optionnel)
 *   - address (TEXT NULL → optionnel)
 *   - postal_code (TEXT NULL → optionnel)
 *
 * Les colonnes city_id / country_code / lat / lon ne sont PAS éditables ici
 * (besoin d'un picker dédié et d'une logique de géocodage — out of scope #89).
 */
import { z } from "zod";

// Limite raisonnable pour empêcher un payload pathologique
const MAX_TEXT = 2000;
const MAX_SHORT = 200;
const MAX_URL = 500;

// Convertit "" en undefined avant validation (les inputs HTML renvoient "" et non null)
const optionalString = (maxLen: number) =>
  z
    .string()
    .max(maxLen)
    .transform((v) => v.trim())
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

export const venueEditSchema = z.object({
  name: z
    .string()
    .max(MAX_SHORT, "name_too_long")
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1, "name_required"),
  description: optionalString(MAX_TEXT),
  website_url: z
    .string()
    .max(MAX_URL)
    .transform((v) => v.trim())
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine(
      (v) => v === null || /^https?:\/\/.+/i.test(v),
      "website_invalid",
    ),
  phone: optionalString(MAX_SHORT),
  address: optionalString(MAX_TEXT),
  postal_code: optionalString(50),
});

export type VenueEditInput = z.infer<typeof venueEditSchema>;
