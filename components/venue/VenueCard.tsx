/**
 * Card de venue pour les grilles et listes — Server Component.
 *
 * Lisibilité & hiérarchie d'action (#606) :
 *   - le nom est le titre cliquable (stretched link → toute la card mène à la
 *     fiche, a11y-clean) ;
 *   - action PRIMAIRE visible : « Itinéraire » (lien externe Google Maps) ;
 *   - action secondaire : « Signaler une erreur » (vers /contribute) ;
 *   - le nombre de courts reste discret (peu fiable selon les sources).
 *
 * Les actions ont `relative z-10` pour passer AU-DESSUS du stretched link
 * (sinon un clic dessus déclencherait la navigation vers la fiche).
 */
import Link from "next/link";
import { MapPin, Navigation } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SportChips } from "@/components/venue/SportChips";
import { FavoriteButton } from "@/components/FavoriteButton";
import { getFamilyEmoji, getFamilyColor } from "@/lib/families";
import { formatCityName } from "@/lib/format-city";
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
  // Ville normalisée à l'affichage (#559) — la source livre parfois « PARIS ».
  const location = venue.city_name ? formatCityName(venue.city_name) : (venue.address ?? "");
  const t = await getTranslations("venue");
  const tFav = await getTranslations("favorites");
  const tFamilies = await getTranslations("families");
  // Nom de famille localisé pour l'aria-label/title de l'emoji (#470) — sinon le
  // lecteur d'écran / le tooltip annonçaient le slug brut (« raquette », « hike »).
  const familyName = tFamilies.has(venue.family_slug)
    ? tFamilies(venue.family_slug)
    : venue.family_slug;

  // Itinéraire vers la venue (départ = position de l'utilisateur).
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lon}`;

  return (
    <div className="group relative h-full">
      {/* FavoriteButton : overlay z-20, hors du flux du stretched link. */}
      <div className="absolute right-2 top-2 z-20">
        <FavoriteButton
          venueId={venue.id}
          venueSlug={venue.slug}
          labelAdd={tFav("addLabel")}
          labelRemove={tFav("removeLabel")}
          className="bg-white/90 shadow-sm backdrop-blur-sm"
        />
      </div>

      <Card className="flex h-full flex-col transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
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
            <h3 className="line-clamp-2 text-base font-semibold leading-tight">
              {/* Stretched link : le ::after couvre toute la card → cliquable. */}
              <Link
                href={`/venue/${venue.slug}`}
                className="after:absolute after:inset-0 group-hover:underline"
                tabIndex={0}
              >
                {venue.name}
              </Link>
            </h3>
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col pb-4">
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

          {/* Courts / installations — volontairement discret (#606 : fiabilité
              variable selon les sources, on ne le sur-met pas en avant). */}
          {venue.courts_count != null && venue.courts_count > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("courtsCount", { count: venue.courts_count })}
            </p>
          )}

          {/* Actions — au-dessus du stretched link (z-10). Itinéraire = primaire. */}
          <div className="relative z-10 mt-auto flex items-center justify-between gap-2 pt-3">
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
              {t("directionsShort")}
            </a>
            <Link
              href="/contribute"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("reportError")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
