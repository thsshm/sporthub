"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFamilyColor, getFamilyEmoji, FAMILIES } from "@/lib/families";
import type { VenuePin } from "@/lib/supabase/types";

/**
 * Liste paginée des venues visibles dans la vue carte, triée par distance au
 * centre courant.
 *
 * Pas de fetch interne — c'est `MapClient` qui détient la source des venues
 * (un seul fetch /api/venues?bbox=…) et les remonte via prop. On évite ainsi
 * le double-fetch demandé dans l'issue #123.
 *
 * Comportement clic carte :
 *   - mode `split` : fly-to + popup → délégué via `onVenueClick`
 *   - mode `list`  : navigation /venue/[slug] → <Link> natif (par défaut)
 *
 * Le mode est passé via `interaction` : "fly" déclenche onVenueClick, "navigate"
 * laisse le navigateur suivre le <Link>.
 */
type Props = {
  venues: VenuePin[];
  /** Centre courant de la carte, utilisé pour le tri par distance. */
  center: { lat: number; lon: number } | null;
  /** "fly"      : clic = fly-to (mode split, carte + liste visibles)
   *  "navigate" : clic = lien vers /venue/[slug] (mode list seul) */
  interaction: "fly" | "navigate";
  /** Appelé en mode `interaction="fly"`. Pas appelé en mode navigate. */
  onVenueClick?: (venue: VenuePin) => void;
  className?: string;
};

const PAGE_SIZE = 30;

/** Distance haversine en km — assez précise pour trier des listes de spots
 * sur un viewport de quelques km à quelques centaines de km. */
function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

type SortedVenue = VenuePin & { _distKm: number | null };

export function VenueListPanel({
  venues,
  center,
  interaction,
  onVenueClick,
  className,
}: Props) {
  const t = useTranslations("map.viewMode");
  const [page, setPage] = useState(1);

  const sorted = useMemo<SortedVenue[]>(() => {
    if (!center) {
      return venues.map((v) => ({ ...v, _distKm: null }));
    }
    return venues
      .map((v) => ({
        ...v,
        _distKm: haversineKm(center, { lat: v.lat, lon: v.lon }),
      }))
      .sort((a, b) => (a._distKm ?? 0) - (b._distKm ?? 0));
  }, [venues, center]);

  const visible = sorted.slice(0, page * PAGE_SIZE);
  const hasMore = sorted.length > visible.length;

  return (
    <aside
      aria-label={t("listLabel")}
      className={`flex flex-col bg-background ${className ?? ""}`}
    >
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {t("listCount", { count: sorted.length })}
        </h2>
      </header>
      {sorted.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          {t("listEmpty")}
        </div>
      ) : (
        <ul className="flex-1 divide-y overflow-y-auto">
          {visible.map((v) => {
            const family = FAMILIES.find((f) => f.slug === v.family_slug);
            const familyColor = getFamilyColor(v.family_slug);
            const familyLabel = family?.name_fr ?? v.family_slug;
            const distLabel =
              v._distKm !== null ? formatDistance(v._distKm) : null;
            const sportLabel = v.primary_sport_slug
              ? v.primary_sport_slug.replaceAll("_", " ")
              : null;

            // Contenu identique pour les 2 variantes interaction (button vs Link).
            const inner = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
                    {v.name}
                  </h3>
                  {distLabel && (
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                      {distLabel}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: familyColor }}
                  >
                    <span aria-hidden="true">
                      {getFamilyEmoji(v.family_slug)}
                    </span>
                    {familyLabel}
                  </span>
                  {sportLabel && (
                    <span className="truncate capitalize text-muted-foreground">
                      {sportLabel}
                    </span>
                  )}
                </div>
              </>
            );

            return (
              <li key={v.id}>
                {interaction === "fly" ? (
                  <button
                    type="button"
                    onClick={() => onVenueClick?.(v)}
                    className="w-full px-4 py-3 text-left transition hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={`/venue/${v.slug}`}
                    className="block w-full px-4 py-3 transition hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="border-t p-3">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="w-full rounded-md border bg-background px-3 py-2 text-xs font-medium transition hover:bg-accent"
          >
            {t("listLoadMore")}
          </button>
        </div>
      )}
    </aside>
  );
}
