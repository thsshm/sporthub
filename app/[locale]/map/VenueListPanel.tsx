"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { getFamilyEmoji } from "@/lib/families";
import type { VenuePin } from "@/lib/supabase/types";

/**
 * Panneau liste des venues visibles sur /map (#123).
 * Pas de fetch propre — reçoit les venues déjà fetched par MapClient
 * (via callback `onVenuesData`) pour éviter le double appel API.
 *
 * Tri : par distance au centre courant (Haversine simple, suffisant à cette échelle).
 * Cap : top 100 affichés (au-delà l'utilisateur doit pan/zoomer).
 */
type Props = {
  venues: VenuePin[];
  center: { lat: number; lon: number };
  /** Clic sur une card → fly-to via parent. */
  onSelect?: (venue: VenuePin) => void;
  className?: string;
};

const MAX_ITEMS = 100;

/** Haversine — distance en km entre 2 coords. Suffisant pour le tri (pas d'audit géodésique). */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function VenueListPanel({ venues, center, onSelect, className }: Props) {
  const t = useTranslations("map.list");
  // Nom de sport localisé (#476) — sinon slug brut anglais dans la liste viewport.
  const tSports = useTranslations("sports");

  const sorted = useMemo(() => {
    return venues
      .map((v) => ({ v, d: distanceKm(center, { lat: v.lat, lon: v.lon }) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_ITEMS);
  }, [venues, center]);

  if (sorted.length === 0) {
    return (
      <aside
        aria-label={t("title")}
        className={`flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        <p>{t("empty")}</p>
      </aside>
    );
  }

  return (
    <aside aria-label={t("title")} className={`flex flex-col overflow-y-auto ${className ?? ""}`}>
      <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2 text-xs font-semibold text-muted-foreground backdrop-blur">
        {t("countNearest", { count: sorted.length })}
      </div>
      <ul className="divide-y">
        {sorted.map(({ v, d }) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelect?.(v)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-accent"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg"
              >
                {getFamilyEmoji(v.family_slug)}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/venue/${v.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate text-sm font-medium text-foreground hover:underline"
                >
                  {v.name}
                </Link>
                {v.primary_sport_slug && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {tSports.has(v.primary_sport_slug)
                      ? tSports(v.primary_sport_slug)
                      : v.primary_sport_slug.replaceAll("_", " ")}{" "}
                    · {d.toFixed(d < 10 ? 1 : 0)} km
                  </span>
                )}
                {!v.primary_sport_slug && (
                  <span className="block text-xs text-muted-foreground">
                    {d.toFixed(d < 10 ? 1 : 0)} km
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
