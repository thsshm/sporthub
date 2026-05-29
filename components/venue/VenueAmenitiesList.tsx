/**
 * Liste des amenities / caractéristiques scalaires d'une venue — Server Component.
 *
 * Grille d'icônes pour les booléens scalaires (`is_indoor`, `has_lighting`,
 * `is_wheelchair_accessible`, `fee_required`) + nombre de courts si dispo.
 *
 * Gracieux : si tous les flags sont null/false (donnée pauvre), retourne null
 * → pas de bloc "Caractéristiques" vide.
 */
import { getTranslations } from "next-intl/server";
import {
  Home,
  Lightbulb,
  Accessibility,
  Coins,
  CircleDollarSign,
  LayoutGrid,
} from "lucide-react";
import type { VenueDetail } from "@/lib/supabase/types";

type Props = {
  venue: VenueDetail;
};

type Feature = {
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
};

export async function VenueAmenitiesList({ venue }: Props) {
  const t = await getTranslations("venue");

  const features: Feature[] = [];
  if (venue.is_indoor === true) {
    features.push({ icon: Home, labelKey: "amenity.indoor" });
  }
  if (venue.has_lighting === true) {
    features.push({ icon: Lightbulb, labelKey: "amenity.lighting" });
  }
  if (venue.is_wheelchair_accessible === true) {
    features.push({ icon: Accessibility, labelKey: "amenity.wheelchair" });
  }
  if (venue.fee_required === false) {
    features.push({ icon: Coins, labelKey: "amenity.free" });
  }
  if (venue.fee_required === true) {
    features.push({ icon: CircleDollarSign, labelKey: "amenity.paid" });
  }

  // Si pas de features booléennes et pas de courts → pas de bloc.
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
              key={f.labelKey}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{t(f.labelKey)}</span>
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
