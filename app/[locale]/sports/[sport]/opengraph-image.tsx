/**
 * Dynamic Open Graph image for sport listing pages.
 * Sport emoji + name + venues count, family-colored gradient background.
 *
 * See #93.
 */
import { ImageResponse } from "next/og";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";

// See #93 — Node.js runtime (default) for Supabase compat.
export const alt = "Sport Hub sport preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { locale: string; sport: string };

async function fetchVenueCount(sportSlug: string): Promise<number> {
  const sb = getSupabaseServerClient();
  const { count } = await sb
    .from("venue")
    .select("id", { count: "planned", head: true })
    .eq("primary_sport_slug", sportSlug)
    .eq("is_published", true);
  return count ?? 0;
}

export default async function Image({ params }: { params: Params }) {
  const { sport: sportSlug } = (await Promise.resolve(params)) as Params;
  const sport = SPORTS_BY_SLUG[sportSlug];
  const family = sport ? FAMILIES_BY_SLUG[sport.family_slug] : undefined;
  const emoji = sport?.emoji || family?.emoji || "🏟️";
  const color = family?.color ?? "#1a1f24";
  const name = sport?.name_fr ?? sportSlug;
  const venueCount = sport ? await fetchVenueCount(sportSlug) : 0;
  const countLine =
    venueCount > 0
      ? `${venueCount.toLocaleString("fr-FR")} spot${venueCount > 1 ? "s" : ""}`
      : "Carte mondiale";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "80px",
          background: `linear-gradient(135deg, ${color} 0%, #0f172a 100%)`,
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 180, lineHeight: 1, marginBottom: 30 }}>
          {emoji}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1 }}>
          {name}
        </div>
        <div style={{ fontSize: 36, opacity: 0.85, marginTop: 18 }}>
          {countLine}
        </div>
        <div
          style={{
            marginTop: "auto",
            fontSize: 22,
            opacity: 0.7,
          }}
        >
          sporthubmap.com
        </div>
      </div>
    ),
    { ...size },
  );
}
