/**
 * Dynamic Open Graph image for programmatic pages: sport × city.
 * Sport emoji + city name + sport name + venues count.
 *
 * See #93.
 */
import { ImageResponse } from "next/og";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG } from "@/lib/families";

// See #93 — Node.js runtime (default) for Supabase compat.
export const alt = "Sport Hub city × sport preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = {
  locale: string;
  sport: string;
  country: string;
  city: string;
};

type CityRow = { id: string; name: string };

async function fetchCityAndCount(
  sportSlug: string,
  countryCode: string,
  citySlug: string,
): Promise<{ city: CityRow | null; count: number }> {
  const sb = getSupabaseServerClient();
  const { data: cityRow } = await sb
    .from("city")
    .select("id, name")
    .eq("country_code", countryCode.toUpperCase())
    .eq("slug", citySlug)
    .maybeSingle();

  const city = (cityRow as CityRow | null) ?? null;
  if (!city) return { city: null, count: 0 };

  const { count } = await sb
    .from("venue")
    .select("id", { count: "planned", head: true })
    .eq("primary_sport_slug", sportSlug)
    .eq("city_id", city.id)
    .eq("is_published", true);

  return { city, count: count ?? 0 };
}

export default async function Image({ params }: { params: Params }) {
  const {
    sport: sportSlug,
    country,
    city: citySlug,
  } = (await Promise.resolve(params)) as Params;
  const sport = SPORTS_BY_SLUG[sportSlug];
  const family = sport ? FAMILIES_BY_SLUG[sport.family_slug] : undefined;
  const emoji = sport?.emoji || family?.emoji || "🏟️";
  const color = family?.color ?? "#1a1f24";
  const sportName = sport?.name_fr ?? sportSlug;

  const { city, count } = sport
    ? await fetchCityAndCount(sportSlug, country, citySlug)
    : { city: null, count: 0 };
  const cityName = city?.name ?? citySlug;

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
        <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05 }}>
          {sportName} à {cityName}
        </div>
        <div style={{ fontSize: 32, opacity: 0.85, marginTop: 14 }}>
          {count > 0
            ? `${count.toLocaleString("fr-FR")} spot${count > 1 ? "s" : ""}`
            : "Carte mondiale"}
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
