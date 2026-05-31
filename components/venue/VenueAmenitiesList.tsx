/**
 * Liste des amenities / caractéristiques d'une venue — Server Component.
 *
 * Combine deux sources :
 *   - colonnes scalaires de `venue` (is_indoor, has_lighting, fee_required)
 *   - amenities issues du M:N `venue_amenity` joint à `amenity` (douche,
 *     vestiaire, wifi, bar…). On exclut celles déjà traitées par
 *     `VenueAccessibility` (parking, bike_parking, public_transit, wheelchair).
 *
 * Gracieux : si tous les flags sont null/false ET pas d'amenity DB →
 * retourne null. Pas de bloc "Caractéristiques" vide.
 */
import { getTranslations, getLocale } from "next-intl/server";
import {
  Home,
  Lightbulb,
  Coins,
  CircleDollarSign,
  LayoutGrid,
  Check,
} from "lucide-react";
import type { VenueDetail, VenueAmenity, Amenity } from "@/lib/supabase/types";

type Props = {
  venue: VenueDetail;
};

type Feature = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
};

type VenueAmenityRow = VenueAmenity & { amenity?: Amenity | null };

/** Slugs gérés par VenueAccessibility — à exclure ici pour éviter les doublons. */
const ACCESSIBILITY_SLUGS = new Set([
  "parking",
  "bike_parking",
  "public_transit",
  "wheelchair",
]);

export async function VenueAmenitiesList({ venue }: Props) {
  const t = await getTranslations("venue");
  const locale = await getLocale();
  const lang = locale === "en" || locale === "zh" ? locale : "fr";

  const features: Feature[] = [];
  if (venue.is_indoor === true) {
    features.push({ key: "indoor", icon: Home, label: t("amenity.indoor") });
  }
  if (venue.has_lighting === true) {
    features.push({
      key: "lighting",
      icon: Lightbulb,
      label: t("amenity.lighting"),
    });
  }
  if (venue.fee_required === false) {
    features.push({ key: "free", icon: Coins, label: t("amenity.free") });
  }
  if (venue.fee_required === true) {
    features.push({
      key: "paid",
      icon: CircleDollarSign,
      label: t("amenity.paid"),
    });
  }

  // Amenities DB (jointure M:N) — on prend la version localisée du nom.
  const dbAmenities = ((venue.amenities ?? []) as VenueAmenityRow[]).filter(
    (row) => !ACCESSIBILITY_SLUGS.has(row.amenity_slug) && row.amenity,
  );
  for (const row of dbAmenities) {
    const a = row.amenity!;
    // Skip si on a déjà la feature scalaire équivalente.
    if (a.slug === "indoor" && venue.is_indoor === true) continue;
    if (a.slug === "lighting" && venue.has_lighting === true) continue;
    const label = lang === "en" ? a.name_en : a.name_fr;
    features.push({ key: `db:${a.slug}`, icon: Check, label });
  }

  if (features.length === 0 && !venue.courts_count) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("amenitiesTitle")}
      </h2>
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <li
              key={f.key}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
            >
              <Icon
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{f.label}</span>
            </li>
          );
        })}
        {venue.courts_count != null && venue.courts_count > 0 && (
          <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <LayoutGrid
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("courtsCount", { count: venue.courts_count })}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
