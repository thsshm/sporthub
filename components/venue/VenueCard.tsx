/**
 * Card de venue pour les grilles et listes — Server Component.
 * Affiche nom, famille, ville, sports, lien vers la page détail.
 */
import Link from "next/link";
import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SportChips } from "@/components/venue/SportChips";
import { FavoriteButton } from "@/components/FavoriteButton";
import { getFamilyEmoji, getFamilyColor } from "@/lib/families";
import { formatCityName } from "@/lib/format/city-name";
import type { VenuePin } from "@/lib/supabase/types";

type Props = {
  venue: VenuePin & {
    city_name?: string;
    country_code?: string;
    sport_slugs?: string[];
    address?: string | null;
    courts_count?: number | null;
  };
};

export async function VenueCard({ venue }: Props) {
  const emoji = getFamilyEmoji(venue.family_slug);
  const familyColor = getFamilyColor(venue.family_slug);
  const location = formatCityName(venue.city_name) || venue.address || "";
  const t = await getTranslations("venue");
  const tFav = await getTranslations("favorites");
  const tFamilies = await getTranslations("families");
  // Nom de famille localisé pour l'aria-label/title de l'emoji (#470) — sinon le
  // lecteur d'écran / le tooltip annonçaient le slug brut (« raquette », « hike »).
  const familyName = tFamilies.has(venue.family_slug)
    ? tFamilies(venue.family_slug)
    : venue.family_slug;

  return (
    <div className="group relative block">
      {/* FavoriteButton est en overlay positionné absolu hors du Link
          parent : un click stopPropagation/preventDefault, donc on évite
          d'imbriquer un <button> dans un <a> (a11y + nesting validity). */}
      <div className="absolute right-2 top-2 z-10">
        <FavoriteButton
          venueId={venue.id}
          venueSlug={venue.slug}
          labelAdd={tFav("addLabel")}
          labelRemove={tFav("removeLabel")}
          className="bg-white/90 shadow-sm backdrop-blur-sm"
        />
      </div>

      <Link href={`/venue/${venue.slug}`} className="block" tabIndex={0}>
        <Card className="h-full transition-shadow hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
          {/* Bande couleur famille */}
          <div
            className="h-1.5 rounded-t-lg"
            style={{ backgroundColor: familyColor }}
            aria-hidden="true"
          />

          <CardHeader className="pb-2 pr-12 pt-4">
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 text-xl leading-none"
                aria-label={familyName}
                title={familyName}
              >
                {emoji}
              </span>
              <h3 className="line-clamp-2 text-base font-semibold leading-tight group-hover:underline">
                {venue.name}
              </h3>
            </div>
          </CardHeader>

          <CardContent className="pb-4">
            {/* Localisation */}
            {location && (
              <p className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{location}</span>
                {venue.country_code && (
                  <span className="ml-1 text-xs opacity-60">({venue.country_code})</span>
                )}
              </p>
            )}

            {/* Sports */}
            {venue.sport_slugs && venue.sport_slugs.length > 0 && (
              <SportChips sportSlugs={venue.sport_slugs.slice(0, 4)} className="mt-1" />
            )}

            {/* Courts / installations */}
            {venue.courts_count != null && venue.courts_count > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("courtsCount", { count: venue.courts_count })}
              </p>
            )}
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
