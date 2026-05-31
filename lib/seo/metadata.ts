/**
 * Helpers pour construire les métadonnées Next.js (title, description, OG, Twitter, schema.org).
 * Centralise les defaults pour éviter les incohérences entre pages.
 */
import type { Metadata } from "next";
import type { VenueDetail } from "@/lib/supabase/types";
import { getFamilyEmoji } from "@/lib/families";
import { parseOpeningHours, toSchemaOpeningHours } from "@/lib/venue/opening-hours";

const SITE_URL = "https://sporthubmap.com";
const SITE_NAME = "Sport Hub";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

// On duplique volontairement la config locales ici (au lieu d'importer
// `routing` depuis `@/i18n/routing`) pour garder ce module sans dépendance
// sur `next-intl/navigation`, ce qui permet aux tests vitest (env node) de
// l'importer sans avoir besoin du runtime Next. Source de vérité reste
// `i18n/routing.ts`. Si ces constantes divergent, ajouter un test.
const HREFLANG_LOCALES = ["fr", "en", "zh"] as const;
const HREFLANG_DEFAULT_LOCALE = "fr" as const;

/**
 * Construit les alternates hreflang pour une page de contenu identique
 * publiée sur les 3 locales (#108).
 *
 * Convention de préfixe (`localePrefix: "as-needed"`, cf. `i18n/routing.ts`) :
 *   - FR (default) → URL sans préfixe (`/path`)
 *   - EN          → `/en/path`
 *   - ZH          → `/zh/path`
 *
 * Émet aussi `x-default` (recommandation Google) → renvoie sur le FR canonique.
 * Renvoie des URLs absolues — `metadataBase` peut être absent sur certaines
 * pages, donc on ne dépend pas de la résolution relative.
 *
 * @param path - chemin sans locale ni domaine, p.ex. `/map`, `/venue/abc`, `/`.
 */
export function buildHreflangAlternates(path: string): {
  canonical: string;
  languages: Record<string, string>;
} {
  // Normalise : pour "/", on veut "" derrière le locale (sinon "/en/")
  const cleanPath = path === "/" ? "" : path;
  const languages: Record<string, string> = {};
  for (const l of HREFLANG_LOCALES) {
    const localePrefix = l === HREFLANG_DEFAULT_LOCALE ? "" : `/${l}`;
    // FR root = "/" (pas ""), autres = /xx ou /xx/path
    const href =
      cleanPath === "" && l === HREFLANG_DEFAULT_LOCALE
        ? `${SITE_URL}/`
        : `${SITE_URL}${localePrefix}${cleanPath}`;
    languages[l] = href;
  }
  // x-default = FR (URL canonique sans préfixe). Google recommande
  // x-default pour signaler la page à servir aux locales non listées.
  languages["x-default"] = languages[HREFLANG_DEFAULT_LOCALE];
  return {
    canonical: languages[HREFLANG_DEFAULT_LOCALE],
    languages,
  };
}

/**
 * Metadata de base pour la landing.
 */
export function buildHomeMetadata(): Metadata {
  const hreflang = buildHreflangAlternates("/");
  return {
    title: {
      default: "Sport Hub · Une seule carte pour tous tes sports",
      template: "%s · Sport Hub",
    },
    description:
      "Trouve où pratiquer ton sport : tennis, padel, surf, yoga, foot, pétanque… 267 000 spots dans 13 familles, partout dans le monde. Données ouvertes, sans inscription.",
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: SITE_NAME,
      title: "Sport Hub · Une seule carte pour tous tes sports",
      description:
        "267 000 spots sportifs dans le monde — tennis, padel, surf, yoga, foot, pétanque et plus encore.",
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Sport Hub" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Sport Hub · Une seule carte pour tous tes sports",
      description: "267 000 spots sportifs dans le monde, données ouvertes.",
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Metadata pour une page venue.
 */
export function buildVenueMetadata(venue: VenueDetail, cityName?: string): Metadata {
  const emoji = getFamilyEmoji(venue.family_slug);
  const location = cityName ?? venue.address ?? "";
  const title = `${venue.name}${location ? ` · ${location}` : ""}`;
  const description =
    venue.description ??
    `${emoji} Retrouve ${venue.name}${location ? ` à ${location}` : ""} sur Sport Hub — horaires, contacts, sports pratiqués.`;

  const photoUrl = (venue.enrichments as { photo_url?: string })?.photo_url;
  const ogImage = photoUrl ?? DEFAULT_OG_IMAGE;
  const venueUrl = `${SITE_URL}/venue/${venue.slug}`;

  // hreflang alternates : la même venue est publiée sous FR/EN/ZH (mêmes
  // contenus métier, UI localisée). Permet à Google d'indexer la bonne URL
  // par locale et d'éviter le piège "URL identique → uniquement FR indexé"
  // (#108).
  const hreflang = buildHreflangAlternates(`/venue/${venue.slug}`);

  return {
    title,
    description,
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
    openGraph: {
      type: "website",
      url: venueUrl,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: venue.name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

/**
 * Schema.org JSON-LD pour une venue (SportsActivityLocation).
 * À injecter dans <script type="application/ld+json">.
 *
 * Champs enrichis (issue #127) : `openingHoursSpecification`, `priceRange`,
 * `amenityFeature`, `image`. Tous omis si la donnée correspondante est absente,
 * pour rester gracieux face aux venues pauvres (terrains de pétanque rural,
 * etc.).
 */
export function buildVenueJsonLd(venue: VenueDetail, cityName?: string): object {
  const enrichments = (venue.enrichments ?? {}) as Record<string, unknown>;
  const rawTags = (enrichments.raw_tags ?? {}) as Record<string, string>;

  // openingHoursSpecification — parse OSM si dispo
  const openingHoursRaw = rawTags.opening_hours;
  const openingHoursSpecs = openingHoursRaw ? parseOpeningHours(openingHoursRaw) : null;
  const openingHoursSpecification = openingHoursSpecs
    ? toSchemaOpeningHours(openingHoursSpecs)
    : undefined;

  // amenityFeature : booléens scalaires → LocationFeatureSpecification
  const amenityFeature: Record<string, unknown>[] = [];
  if (venue.is_indoor === true) {
    amenityFeature.push({
      "@type": "LocationFeatureSpecification",
      name: "Indoor",
      value: true,
    });
  }
  if (venue.has_lighting === true) {
    amenityFeature.push({
      "@type": "LocationFeatureSpecification",
      name: "Lighting",
      value: true,
    });
  }
  if (venue.is_wheelchair_accessible === true) {
    amenityFeature.push({
      "@type": "LocationFeatureSpecification",
      name: "Wheelchair accessible",
      value: true,
    });
  }
  // amenities depuis le M:N venue_amenity → amenity (#127)
  // On utilise le nom anglais pour stabilité Schema.org indépendamment de la
  // langue de la page.
  for (const a of venue.amenities ?? []) {
    if (!a.amenity) continue;
    amenityFeature.push({
      "@type": "LocationFeatureSpecification",
      name: a.amenity.name_en,
      value: true,
    });
  }

  const photoUrl = (enrichments.photo_url as string | undefined) ?? undefined;
  // Photos additionnelles si présentes dans enrichments.photos
  const extraPhotos = Array.isArray(enrichments.photos)
    ? (enrichments.photos as string[]).filter((p) => typeof p === "string")
    : [];
  const allPhotos = photoUrl ? [photoUrl, ...extraPhotos] : extraPhotos;
  const imageField =
    allPhotos.length > 1
      ? allPhotos
      : allPhotos.length === 1
        ? allPhotos[0]
        : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: venue.name,
    url: `${SITE_URL}/venue/${venue.slug}`,
    description: venue.description,
    image: imageField,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address,
      addressLocality: cityName,
      postalCode: venue.postal_code,
      addressCountry: venue.country_code,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: venue.lat,
      longitude: venue.lon,
    },
    telephone: venue.phone,
    email: venue.email,
    priceRange: venue.price_range ?? undefined,
    openingHoursSpecification,
    amenityFeature: amenityFeature.length > 0 ? amenityFeature : undefined,
    sameAs: enrichments?.wikipedia_url
      ? [enrichments.wikipedia_url as string]
      : undefined,
    aggregateRating:
      enrichments?.google_rating
        ? {
            "@type": "AggregateRating",
            ratingValue: enrichments.google_rating,
            reviewCount: enrichments.google_rating_count ?? 0,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
  };
}

/**
 * Schema.org JSON-LD WebSite pour la landing.
 */
export function buildWebsiteJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/map?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * BreadcrumbList — fil d'Ariane Schema.org pour aider Google à comprendre
 * la hiérarchie des pages. À utiliser sur toutes les pages "profondes"
 * (venue, sports, [sport]/[country]/[city]).
 *
 * @param items - [{name, url}] dans l'ordre du parcours (home → … → page courante)
 */
export function buildBreadcrumbJsonLd(
  items: { name: string; url: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * ItemList — liste ordonnée d'éléments (ex. venues d'un sport ou d'une ville).
 * Utile pour les SERP rich results "carousel" de Google.
 *
 * @param name - Nom de la liste (ex. "Courts de tennis à Paris")
 * @param items - [{name, url}] des venues affichées
 */
export function buildItemListJsonLd(
  name: string,
  items: { name: string; url: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

/**
 * Place — entité géographique (ville). Permet à Google de comprendre que
 * la page `/[sport]/[country]/[city]` parle d'un lieu, pas juste d'un sport.
 */
export function buildPlaceJsonLd(city: {
  name: string;
  country_code: string;
  url: string;
}): object {
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    name: city.name,
    address: {
      "@type": "PostalAddress",
      addressLocality: city.name,
      addressCountry: city.country_code,
    },
    url: city.url,
  };
}

/**
 * Sérialise un objet JSON-LD pour injection dans un
 * `<script type="application/ld+json" dangerouslySetInnerHTML>`.
 *
 * Échappe le caractère `<` en sa séquence unicode : sans ça, une donnée
 * externe contenant une balise de fermeture script (un nom de venue/ville
 * scrapé d'OSM, par ex.) romprait la balise et permettrait une XSS stockée.
 * La sortie échappée reste un JSON-LD valide.
 */
export function jsonLdHtml(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
