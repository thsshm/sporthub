/**
 * Bloc accessibilité & accès — Server Component (#127).
 *
 * Agrège trois sources :
 *   - `is_wheelchair_accessible` (colonne dédiée venue) → PMR
 *   - amenity `parking` ou `bike_parking` (jointure venue_amenity)
 *   - amenity `public_transit` (jointure venue_amenity)
 *
 * Gracieux : si aucune info → null. Aucun bloc "Pas de PMR" ni "Pas de
 * parking" — on n'affiche que ce qui est positif.
 */
import { getTranslations } from "next-intl/server";
import { Accessibility, ParkingCircle, Bus, Bike } from "lucide-react";
import type {
  VenueDetail,
  VenueAmenity,
  Amenity,
} from "@/lib/supabase/types";

type Props = {
  venue: VenueDetail;
};

type VenueAmenityRow = VenueAmenity & { amenity?: Amenity | null };

export async function VenueAccessibility({ venue }: Props) {
  const t = await getTranslations("venue");
  const amenities = (venue.amenities ?? []) as VenueAmenityRow[];

  const hasPmr = venue.is_wheelchair_accessible === true;
  const hasParking = amenities.some((a) => a.amenity_slug === "parking");
  const hasBikeParking = amenities.some((a) => a.amenity_slug === "bike_parking");
  const hasTransit = amenities.some((a) => a.amenity_slug === "public_transit");

  if (!hasPmr && !hasParking && !hasBikeParking && !hasTransit) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("accessibilityTitle")}
      </h2>
      <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {hasPmr && (
          <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <Accessibility
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("amenity.wheelchair")}</span>
          </li>
        )}
        {hasParking && (
          <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <ParkingCircle
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("amenity.parking")}</span>
          </li>
        )}
        {hasBikeParking && (
          <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <Bike
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("amenity.bikeParking")}</span>
          </li>
        )}
        {hasTransit && (
          <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <Bus
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("amenity.publicTransit")}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
