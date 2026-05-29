/**
 * Helpers Schema.org pour les pages SportHub (Place, ItemList, BreadcrumbList…).
 *
 * Pourquoi un fichier dédié et pas tout dans `metadata.ts` :
 *   - `metadata.ts` se concentre sur l'API Next `Metadata` (title/OG/Twitter).
 *   - Ce fichier centralise la construction des objets schema.org et leur
 *     sérialisation HTML (`<script type="application/ld+json">…`).
 *
 * La fonction de rendu `renderJsonLd` retourne un élément React (`<script>`)
 * prêt à injecter dans n'importe quelle page Server Component.
 *
 * NB sur SITE_URL : on duplique volontairement la constante avec `metadata.ts`
 * (héritage scaffold) car `lib/env.ts` n'expose pas (encore) de
 * `NEXT_PUBLIC_SITE_URL`. Si un jour ça change, centraliser à un seul endroit.
 */
import { createElement, type ReactElement } from "react";

const SITE_URL = "https://sporthubmap.com";

/**
 * Locale par défaut. Dupliqué depuis `i18n/routing.ts` pour garder ce module
 * pur (testable sans charger next-intl/navigation, qui dépend du runtime Next).
 * Doit rester synchronisé avec `routing.defaultLocale`.
 */
const DEFAULT_LOCALE = "fr";

/** Types schema.org minimaux utilisés sur le site. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | JsonLdObject
  | JsonLdValue[];

export interface JsonLdObject {
  "@context"?: string;
  "@type": string;
  [key: string]: JsonLdValue | undefined;
}

export interface BreadcrumbItem {
  name: string;
  /** Path local (ex. `/sports/tennis`), sans domaine ni locale. */
  path: string;
}

export interface ListItemVenue {
  /** Slug venue, sert à construire `/venue/<slug>`. */
  slug: string;
  name: string;
}

export interface PlaceCity {
  name: string;
  /** ISO-3166-1 alpha-2 ex. "FR", "US". */
  countryCode: string;
  /** Optionnel — si on a les coords du centre-ville. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * Construit l'URL absolue d'un path local en prenant en compte le locale.
 * FR (default) = pas de préfixe, autres locales = /<locale>/...
 */
export function absoluteUrl(path: string, locale?: string): string {
  const prefix = locale && locale !== DEFAULT_LOCALE ? `/${locale}` : "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${prefix}${cleanPath}`;
}

/**
 * BreadcrumbList schema.org — fil d'Ariane indexable.
 * Cf. https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[],
  locale?: string,
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: absoluteUrl(item.path, locale),
    })),
  };
}

/**
 * ItemList schema.org — liste de venues affichées sur une page (sport, ville…).
 * Note : on liste seulement les venues réellement rendues sur la page courante,
 * pas l'ensemble du sport (Google ne récompense pas les listes trompeuses).
 */
export function buildVenuesItemListJsonLd(
  venues: ListItemVenue[],
  locale?: string,
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: venues.map((v, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: absoluteUrl(`/venue/${v.slug}`, locale),
      name: v.name,
    })),
  };
}

/**
 * Place schema.org pour une ville. Utilisé sur `/[sport]/[country]/[city]`
 * pour marquer la zone géographique couverte par la page.
 */
export function buildCityPlaceJsonLd(city: PlaceCity): JsonLdObject {
  const place: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: city.name,
    address: {
      "@type": "PostalAddress",
      addressLocality: city.name,
      addressCountry: city.countryCode,
    },
  };
  if (typeof city.lat === "number" && typeof city.lon === "number") {
    place.geo = {
      "@type": "GeoCoordinates",
      latitude: city.lat,
      longitude: city.lon,
    };
  }
  return place;
}

/**
 * Sérialise un objet schema.org en `<script type="application/ld+json">…</script>`.
 * Retourne un ReactElement injectable directement dans une page Server Component.
 *
 * On utilise `dangerouslySetInnerHTML` car React n'injecterait pas le
 * `Content-Type` JSON sinon. La chaîne est échappée pour empêcher une
 * fermeture prématurée de la balise script si une valeur contient `</script>`.
 */
export function renderJsonLd(obj: JsonLdObject | JsonLdObject[]): ReactElement {
  const html = JSON.stringify(obj).replace(/</g, "\\u003c");
  return createElement("script", {
    type: "application/ld+json",
    dangerouslySetInnerHTML: { __html: html },
  });
}
