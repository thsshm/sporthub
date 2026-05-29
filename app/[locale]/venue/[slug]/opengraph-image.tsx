/**
 * Dynamic Open Graph image for venue pages.
 * Replaces the static og-image.png with a contextual preview:
 * family emoji + venue name + city + family color background.
 *
 * Generated at request time via next/og's ImageResponse (Twemoji built-in).
 * See #93.
 */
import { ImageResponse } from "next/og";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES_BY_SLUG } from "@/lib/families";

// Note : Node.js runtime (default) — Supabase server client uses next/headers
// cookies which work better outside the edge runtime. ImageResponse caching
// is handled by Vercel CDN per URL anyway.
export const alt = "Sport Hub venue preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { locale: string; slug: string };

type VenueRow = {
  name: string;
  city_name: string | null;
  country_code: string | null;
  family_slug: string;
  courts_count: number | null;
};

async function fetchVenue(slug: string): Promise<VenueRow | null> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("venue")
    .select("name, city_name, country_code, family_slug, courts_count")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  return (data as VenueRow | null) ?? null;
}

export default async function Image({ params }: { params: Params }) {
  const { slug } = (await Promise.resolve(params)) as Params;
  const venue = await fetchVenue(slug);

  // Fallback if venue missing (404 etc.) — neutral card.
  const family = venue ? FAMILIES_BY_SLUG[venue.family_slug] : undefined;
  const emoji = family?.emoji ?? "🏟️";
  const color = family?.color ?? "#1a1f24";
  const name = venue?.name ?? "Sport Hub";
  const sub = venue
    ? [venue.city_name, venue.country_code].filter(Boolean).join(" · ")
    : "Carte mondiale des spots sportifs";
  const courtsLine = venue?.courts_count
    ? `${venue.courts_count} installation${venue.courts_count > 1 ? "s" : ""}`
    : "";

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
        <div style={{ fontSize: 160, lineHeight: 1, marginBottom: 24 }}>
          {emoji}
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
            maxWidth: "100%",
          }}
        >
          {name}
        </div>
        {sub && (
          <div style={{ fontSize: 30, opacity: 0.85, marginTop: 14 }}>
            {sub}
          </div>
        )}
        {courtsLine && (
          <div style={{ fontSize: 24, opacity: 0.7, marginTop: 10 }}>
            {courtsLine}
          </div>
        )}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 22,
            opacity: 0.7,
          }}
        >
          <span>sporthubmap.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
