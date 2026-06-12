/**
 * Card de venue pour les grilles et listes — Server Component.
 *
 * Hiérarchie (#606) : titre = nom, ligne localisation, chips sport, terrains
 * (dé-emphasé), puis un footer d'actions. L'action principale « Itinéraire »
 * (Google Maps) est toujours visible ; « Détails » = clic sur le corps de la
 * carte ; « Signaler une erreur » reste secondaire (mailto, comme la fiche).
 *
 * ⚠️ Contrainte a11y : pas de <a> imbriqué dans un <a>. Le corps (header +
 * content) est UN Link vers la fiche ; les actions du footer sont des <a>
 * frères à l'intérieur de la Card, jamais à l'intérieur du Link. Le
 * FavoriteButton reste en overlay positionné hors du Link (cf. #98).
 */
import Link from "next/link";
import { Globe, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { SportChips } from "@/components/venue/SportChips";
import { FavoriteButton } from "@/components/FavoriteButton";
import { getFamilyEmoji, getFamilyColor } from "@/lib/families";
import { formatCityName } from "@/lib/format-city";
import { formatVenueName } from "@/lib/format-venue-name";
import { googleMapsUrl } from "@/lib/utils";
import { safeExternalUrl } from "@/lib/url";
import { SITE_URL } from "@/lib/seo/sitemap-shards";
import { getVenueSourceMeta } from "@/lib/venue/source";
import { getCourtCountDisplay } from "@/lib/venue/courts-plausibility";
import type { VenuePin } from "@/lib/supabase/types";

type Props = {
  venue: VenuePin & {
    city_name?: string;
    country_code?: string;
    sport_slugs?: string[];
    address?: string | null;
    courts_count?: number | null;
    source?: string | null;
    website_url?: string | null;
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
  // Signal de confiance (#607) : provenance ouverte (OSM/RES/Wikidata/Overture).
  // Sans lien (le contenu est déjà dans un <Link> → pas d'<a> imbriqué). null
  // pour les sources internes (hyrox…) → pas de badge.
  const sourceMeta = getVenueSourceMeta(venue.source);
  // Garde-fou d'affichage du nombre de terrains (#636) : sur les cards SEO on ne
  // montre JAMAIS un count invraisemblable (« 112 courts ») — au-delà du seuil
  // par sport/famille on bascule sur « Plusieurs terrains », et on masque
  // totalement l'absurde. Le sport de la page (sport_slugs[0]) affine le seuil
  // (tennis 30 vs padel 16, même famille raquette).
  const courtCount = getCourtCountDisplay(venue.courts_count, {
    sportSlug: venue.sport_slugs?.[0],
    familySlug: venue.family_slug,
  });

  // Actions : Itinéraire (Google Maps, comme la fiche) + Signaler (mailto
  // pré-rempli, même format que /venue/[slug]). Construites côté serveur,
  // fonctionnelles sans JS.
  const mapsHref = googleMapsUrl(venue.lat, venue.lon, venue.name);
  // Action « Site web » (#642) — secondaire, seulement quand la venue a une URL
  // sûre (http(s) ; on rejette javascript:/data: etc., cf. safeExternalUrl).
  // Absente des pages /sports (la MV ne porte pas website_url) → dégradation
  // gracieuse, pas d'incohérence.
  const websiteHref = safeExternalUrl(venue.website_url);
  const venueUrl = `${SITE_URL}/venue/${venue.slug}`;
  const reportHref = `mailto:hello@sporthubmap.com?subject=${encodeURIComponent(
    t("reportErrorSubject", { name: venue.name })
  )}&body=${encodeURIComponent(t("reportErrorBody", { url: venueUrl }))}`;

  return (
    <div className="group relative">
      {/* FavoriteButton en overlay hors du Link (a11y + nesting validity). */}
      <div className="absolute right-2 top-2 z-10">
        <FavoriteButton
          venueId={venue.id}
          venueSlug={venue.slug}
          labelAdd={tFav("addLabel")}
          labelRemove={tFav("removeLabel")}
          className="bg-white/90 shadow-sm backdrop-blur-sm"
        />
      </div>

      <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
        {/* Bande couleur famille */}
        <div
          className="h-1.5 rounded-t-lg"
          style={{ backgroundColor: familyColor }}
          aria-hidden="true"
        />

        {/* Corps cliquable → fiche détail (action « Détails »). */}
        <Link
          href={`/venue/${venue.slug}`}
          className="block flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
        >
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
                {formatVenueName(venue.name)}
              </h3>
            </div>
          </CardHeader>

          <CardContent className="pb-3">
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

            {/* Terrains — dé-emphasé (#606) : badge discret, jamais mis en avant
                comme une donnée certaine (plausibilité des counts traitée en
                amont #555). */}
            {courtCount.kind !== "none" && (
              <p className="mt-2 text-xs text-muted-foreground">
                {courtCount.kind === "exact"
                  ? t("courtsCount", { count: courtCount.count })
                  : t("multipleCourts")}
              </p>
            )}

            {/* Provenance — signal de confiance (#607) */}
            {sourceMeta && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                <span>{t("verifiedFrom", { source: sourceMeta.label })}</span>
              </p>
            )}
          </CardContent>
        </Link>

        {/* Footer d'actions — hors du Link parent (frères <a>). */}
        <CardFooter className="mt-auto gap-3 border-t px-4 py-2.5 text-sm">
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("directions")}
          </a>
          {/* Site web (#642) — secondaire, conditionnel à une URL sûre. */}
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("website")}
            </a>
          )}
          <a
            href={reportHref}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t("reportError")}
          </a>
        </CardFooter>
      </Card>
    </div>
  );
}
