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

type Props = {
  venue: VenueDetail;
};

export async function VenueAbout({ venue }: Props) {
  const t = await getTranslations("venue");
  const enrichments = (venue.enrichments ?? {}) as VenueEnrichments;

  const description = enrichments.description?.trim() || null;
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
