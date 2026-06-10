/**
 * Bloc "À propos" d'une fiche venue — Server Component (#107).
 *
 * Affiche l'extrait Wikipedia (`enrichments.description`) si présent et la
 * section "Pour en savoir plus" avec lien Wikipedia + lien officiel.
 *
 * Gracieux : ne rend RIEN si ni description, ni wikipedia_url, ni website_url
 * ne sont disponibles — pas de bloc fantôme (cf. acceptance #107).
 */
import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import type { VenueDetail, VenueEnrichments } from "@/lib/supabase/types";
import { generateVenueDescription } from "@/lib/venue/description";
import type { DescriptionContext, DescriptionStrings } from "@/lib/venue/description";
import { plausibleCourtCount } from "@/lib/venue/courts-plausibility";

type Props = {
  venue: VenueDetail;
  cityName?: string | null;
  locale?: string;
};

export async function VenueAbout({ venue, cityName, locale = "fr" }: Props) {
  const t = await getTranslations("venue");
  const tSports = await getTranslations("sports");
  const enrichments = (venue.enrichments ?? {}) as VenueEnrichments;

  // Description Wikipedia si présente, sinon description générée (#414).
  const wikiDescription = enrichments.description?.trim() || null;
  const sportSlug = venue.primary_sport_slug;
  const sportName = sportSlug && tSports.has(sportSlug) ? tSports(sportSlug) : sportSlug;
  // Plausibilité (#555) : on n'utilise pas un nb de courts aberrant dans la
  // description générée (« 200 courts de tennis »).
  const courtsCount = plausibleCourtCount(venue.courts_count, venue.family_slug);

  // Construit la description générée si aucune description Wikipedia.
  let description = wikiDescription;
  if (!description && sportName) {
    const ctx: DescriptionContext = {
      sportName,
      cityName: cityName ?? null,
      countryCode: venue.country_code ?? null,
      courtsCount: courtsCount ?? null,
      isIndoor: venue.is_indoor ?? null,
      hasLighting: venue.has_lighting ?? null,
      feeRequired: venue.fee_required ?? null,
    };
    const strings: DescriptionStrings = {
      venueType: sportName,
      indoor: t("amenity.indoor"),
      outdoor: t("outdoor"),
      inCity: locale === "zh" ? "的" : locale === "en" ? "in" : "à",
      courtsPattern:
        locale === "zh" ? "{n} 片球场" : locale === "en" ? "{n} courts" : "{n} terrains",
      lit: locale === "zh" ? "有照明" : locale === "en" ? "lit" : "éclairé",
      freeAccess: locale === "zh" ? "免费进入" : locale === "en" ? "free access" : "accès libre",
      paidAccess: locale === "zh" ? "收费" : locale === "en" ? "paid" : "payant",
    };
    description = generateVenueDescription(ctx, strings);
  }

  const wikipediaUrl = enrichments.wikipedia_url?.trim() || null;
  const wikipediaLabel = enrichments.wikipedia_label?.trim() || null;
  const websiteUrl = venue.website_url?.trim() || null;

  // Rien à afficher → pas de bloc.
  if (!description && !wikipediaUrl && !websiteUrl) {
    return null;
  }

  const websiteHost = websiteUrl
    ? (() => {
        try {
          return new URL(websiteUrl).host;
        } catch {
          return websiteUrl;
        }
      })()
    : null;

  return (
    <section
      aria-labelledby="venue-about-title"
      className="rounded-lg border bg-card p-4"
    >
      <h2
        id="venue-about-title"
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t("about.title")}
      </h2>

      {description && (
        <p className="text-sm leading-relaxed text-foreground/90">
          {description}
        </p>
      )}

      {(wikipediaUrl || websiteUrl) && (
        <div className="mt-3 space-y-1.5 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("about.learnMore")}
          </h3>
          <ul className="space-y-1">
            {wikipediaUrl && (
              <li>
                <a
                  href={wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 underline hover:text-foreground"
                >
                  <span aria-hidden="true">📖</span>
                  <span>{wikipediaLabel || t("about.wikipedia")}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </li>
            )}
            {websiteUrl && websiteHost && (
              <li>
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 underline hover:text-foreground"
                >
                  <span aria-hidden="true">🌐</span>
                  <span>{t("about.officialWebsite", { host: websiteHost })}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
