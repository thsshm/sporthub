/**
 * Badge de provenance d'une venue (#562) — Server Component.
 *
 * Renforce la promesse « Only real spots » : indique la source ouverte d'où
 * vient le lieu (OSM/RES/Wikidata/Overture) + la date de dernière mise à jour.
 * Discret (petite ligne en pied de fiche), donc sans surcharge mobile.
 *
 * Ne rend RIEN si la source est inconnue/interne ET qu'il n'y a pas de date.
 */
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { getVenueSourceMeta } from "@/lib/venue/source";

type Props = {
  source?: string | null;
  updatedAt?: string | null;
  locale: string;
};

export async function VenueProvenance({ source, updatedAt, locale }: Props) {
  const meta = getVenueSourceMeta(source);

  let updated: string | null = null;
  if (updatedAt) {
    const d = new Date(updatedAt);
    if (!Number.isNaN(d.getTime())) {
      updated = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d);
    }
  }

  if (!meta && !updated) return null;

  const t = await getTranslations("venue");

  return (
    <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
      {meta && (
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t("verifiedFrom", { source: meta.label })}
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            ↗
          </a>
        </span>
      )}
      {meta && updated && <span aria-hidden="true">·</span>}
      {updated && <span>{t("updatedAt", { date: updated })}</span>}
    </p>
  );
}
