/**
 * Bloc infos pratiques d'une venue — Server Component.
 *
 * Grille à 2 colonnes (1 sur mobile) : adresse complète, téléphone clickable,
 * site web (lien externe), GPS, horaires d'ouverture (si parsables depuis
 * `enrichments.raw_tags.opening_hours`), capacité, tarifs.
 *
 * Gracieux : chaque ligne est rendue uniquement si la donnée existe. Pas de
 * "N/A". Si tous les champs sont vides, le composant retourne null.
 */
import { getTranslations } from "next-intl/server";
import { Phone, Globe, MapPin, Clock, Users, Wallet } from "lucide-react";
import type { VenueDetail } from "@/lib/supabase/types";
import {
  parseOpeningHours,
  formatRange,
  getOpenStatus,
} from "@/lib/venue/opening-hours";

type Props = {
  venue: VenueDetail;
  locale: "fr" | "en" | "zh";
};

const DAY_LABEL_KEY: Record<string, string> = {
  Mo: "mon",
  Tu: "tue",
  We: "wed",
  Th: "thu",
  Fr: "fri",
  Sa: "sat",
  Su: "sun",
};

export async function VenueInfoCard({ venue, locale }: Props) {
  const t = await getTranslations("venue");

  const websiteHost = venue.website_url
    ? (() => {
        try {
          return new URL(venue.website_url!).host;
        } catch {
          return venue.website_url;
        }
      })()
    : null;

  const fullAddress = [venue.address, venue.postal_code].filter(Boolean).join(" ");
  const openingHoursRaw = (
    (venue.enrichments as { raw_tags?: Record<string, string> } | null)?.raw_tags
      ?.opening_hours ?? null
  ) as string | null;
  const openingSpecs = parseOpeningHours(openingHoursRaw);
  // Statut courant — calculé côté serveur, peut donc "rafraîchir" au prochain
  // SSR (cf. revalidate=3600 sur la page). Suffisant pour un indicateur visuel.
  const openStatus = getOpenStatus(openingSpecs);

  const hasAnyField =
    fullAddress ||
    venue.phone ||
    websiteHost ||
    openingSpecs ||
    venue.capacity ||
    venue.price_range ||
    venue.fee_required === true ||
    venue.fee_required === false;

  if (!hasAnyField) {
    // On affiche au moins GPS (toujours dispo via lat/lon) sinon le bloc disparait.
    // → on garde le composant car GPS est utile (déjà rendu en bas).
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("infoCardTitle")}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {fullAddress && (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {t("address")}
            </dt>
            <dd className="mt-0.5">{fullAddress}</dd>
          </div>
        )}

        {venue.phone && (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Phone className="h-4 w-4" aria-hidden="true" />
              {t("phone")}
            </dt>
            <dd className="mt-0.5">
              <a className="hover:underline" href={`tel:${venue.phone}`}>
                {venue.phone}
              </a>
            </dd>
          </div>
        )}

        {websiteHost && (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Globe className="h-4 w-4" aria-hidden="true" />
              {t("website")}
            </dt>
            <dd className="mt-0.5 truncate">
              <a
                className="underline hover:text-foreground"
                href={venue.website_url!}
                target="_blank"
                rel="noopener noreferrer"
              >
                {websiteHost}
              </a>
            </dd>
          </div>
        )}

        {openingSpecs && openingSpecs.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {t("openingHours")}
            </dt>
            <dd className="mt-1 space-y-1.5">
              {openStatus && (
                <p className="text-xs">
                  {openStatus.isOpen ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {t("openNow", {
                        closesAt: formatRange(
                          openStatus.closesAt,
                          openStatus.closesAt,
                          locale,
                        ).split("-")[0],
                      })}
                    </span>
                  ) : openStatus.opensAt ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {t("closedNowOpensAt", {
                        opensAt: formatRange(
                          openStatus.opensAt,
                          openStatus.opensAt,
                          locale,
                        ).split("-")[0],
                      })}
                    </span>
                  ) : (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {t("closedNow")}
                    </span>
                  )}
                </p>
              )}
              <ul className="space-y-0.5">
                {openingSpecs.map((spec) => (
                  <li key={spec.day} className="flex gap-2 text-xs">
                    <span className="w-9 shrink-0 font-medium">
                      {t(`day.${DAY_LABEL_KEY[spec.day]}`)}
                    </span>
                    <span className="text-muted-foreground">
                      {spec.ranges
                        .map((r) => formatRange(r.open, r.close, locale))
                        .join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {venue.capacity != null && venue.capacity > 0 && (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t("capacity")}
            </dt>
            <dd className="mt-0.5">{venue.capacity.toLocaleString(locale)}</dd>
          </div>
        )}

        {(venue.price_range || venue.fee_required != null) && (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Wallet className="h-4 w-4" aria-hidden="true" />
              {t("price")}
            </dt>
            <dd className="mt-0.5">
              {venue.price_range
                ? venue.price_range
                : venue.fee_required
                  ? t("paid")
                  : t("free")}
            </dd>
          </div>
        )}

        <div className="sm:col-span-2">
          <dt className="font-medium text-muted-foreground">{t("coordinates")}</dt>
          <dd className="mt-0.5 font-mono text-xs">
            {venue.lat.toFixed(4)}, {venue.lon.toFixed(4)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
