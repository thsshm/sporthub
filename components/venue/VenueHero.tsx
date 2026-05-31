/**
 * Hero d'une fiche venue — Server Component.
 *
 * Bannière (photo Wikimedia/Google si dispo, sinon dégradé couleur famille +
 * emoji) → breadcrumb (Sport Hub / Famille / Ville) → nom (H1) → description.
 *
 * Gracieux : si pas de photo, fallback dégradé + emoji centré. Pas de bloc
 * fantôme.
 */
import Image from "next/image";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { FAMILIES_BY_SLUG } from "@/lib/families";
import type { VenueDetail } from "@/lib/supabase/types";
import { wikimediaThumb } from "@/lib/venue/wikimedia";

type Props = {
  venue: VenueDetail;
  cityName?: string | null;
  /** Locale courante — pour le lien famille. */
  locale: string;
};

export async function VenueHero({ venue, cityName, locale }: Props) {
  const tFamilies = await getTranslations("families");
  const family = FAMILIES_BY_SLUG[venue.family_slug];
  const emoji = family?.emoji ?? "🏟️";
  const color = family?.color ?? "#6b7280";
  const rawPhotoUrl = (venue.enrichments as { photo_url?: string } | null)?.photo_url;
  // Bannière hero : 1200 px de large suffit pour un LCP raisonnable même sur
  // écrans 2× ; transforme l'URL `upload.wikimedia.org` en vignette Wikimedia.
  const photoUrl = wikimediaThumb(rawPhotoUrl, 1200) ?? rawPhotoUrl;

  return (
    <header>
      {/* Bannière photo ou fallback dégradé famille */}
      <div className="relative h-48 w-full overflow-hidden rounded-lg sm:h-64">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={venue.name}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
            priority
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          >
            <span className="text-6xl opacity-80">{emoji}</span>
          </div>
        )}
        {/* Gradient sombre en bas pour lisibilité éventuelle */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/30 to-transparent"
          aria-hidden="true"
        />
      </div>

      {/* Breadcrumb */}
      <nav
        className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link href="/" className="hover:text-foreground">
          Sport Hub
        </Link>
        <span aria-hidden="true">›</span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true">{emoji}</span>
          <span>{tFamilies(venue.family_slug)}</span>
        </span>
        {cityName && (
          <>
            <span aria-hidden="true">›</span>
            <span>{cityName}</span>
          </>
        )}
        {venue.country_code && (
          <span className="text-xs opacity-70">({venue.country_code})</span>
        )}
      </nav>

      {/* Titre + description */}
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{venue.name}</h1>
      {venue.description && (
        <p className="mt-3 text-muted-foreground">{venue.description}</p>
      )}

      {/* Locale prop conservée pour usages futurs (i18n routing dynamique) */}
      <span className="sr-only" data-locale={locale} />
    </header>
  );
}
