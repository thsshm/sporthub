/**
 * Liste des sports pratiqués dans une venue, avec détails par sport — Server
 * Component (#127).
 *
 * Pour chaque sport associé via `venue_sport`, affiche :
 *   - nom localisé (du `sport` joint) + emoji
 *   - surface (gazon, dur, synthétique, terre battue…) si dispo
 *   - indoor/outdoor (héritage de la venue : `is_indoor`)
 *   - nombre de courts (`courts_count` au niveau venue_sport)
 *   - badge "principal" pour le sport `is_primary`
 *
 * Gracieux : si pas de sports → null. Pour chaque sport, on n'affiche que les
 * sous-infos disponibles (pas de "—" ni "N/A").
 */
import { getTranslations } from "next-intl/server";
import { Home, Trees, LayoutGrid } from "lucide-react";
import type { VenueDetail, VenueSport, Sport } from "@/lib/supabase/types";

type Props = {
  venue: VenueDetail;
  locale: "fr" | "en" | "zh";
};

type VenueSportRow = VenueSport & { sport?: Sport | null };

const SURFACE_KEY: Record<string, string> = {
  clay: "clay",
  concrete: "concrete",
  synthetic: "synthetic",
  grass: "grass",
  artificial_grass: "artificial_grass",
  asphalt: "asphalt",
  hardcourt: "hardcourt",
  sand: "sand",
  wood: "wood",
  rubber: "rubber",
};

function sportName(row: VenueSportRow, locale: "fr" | "en" | "zh"): string {
  if (!row.sport) return row.sport_slug;
  if (locale === "en") return row.sport.name_en;
  // Pour zh on n'a pas de champ dédié dans `sport` (i18n local pour zh via
  // namespace `sports`). On retombe sur name_en par défaut côté serveur.
  if (locale === "zh") return row.sport.name_en;
  return row.sport.name_fr;
}

export async function VenueSportsList({ venue, locale }: Props) {
  const t = await getTranslations("venue");
  const sports = (venue.sports ?? []) as VenueSportRow[];
  if (sports.length === 0) return null;

  // Trier : principal d'abord, puis alpha
  const sorted = [...sports].sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    return sportName(a, locale).localeCompare(sportName(b, locale));
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("sportsDetailsTitle")}
      </h2>
      <ul className="space-y-2">
        {sorted.map((s) => {
          const surface = s.surface?.toLowerCase().trim();
          const surfaceLabelKey = surface && SURFACE_KEY[surface];
          const isIndoor = venue.is_indoor;
          return (
            <li
              key={s.sport_slug}
              className="rounded-md border bg-card p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                {s.sport?.emoji && (
                  <span aria-hidden="true">{s.sport.emoji}</span>
                )}
                <span className="font-medium">{sportName(s, locale)}</span>
                {s.is_primary && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {t("primarySport")}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {surfaceLabelKey && (
                  <span>{t(`surface.${surfaceLabelKey}`)}</span>
                )}
                {isIndoor === true && (
                  <span className="inline-flex items-center gap-1">
                    <Home className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("amenity.indoor")}
                  </span>
                )}
                {isIndoor === false && (
                  <span className="inline-flex items-center gap-1">
                    <Trees className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("outdoor")}
                  </span>
                )}
                {s.courts_count != null && s.courts_count > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("courtsCount", { count: s.courts_count })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
