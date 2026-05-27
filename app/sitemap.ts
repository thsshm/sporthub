import type { MetadataRoute } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";

const SITE_URL = "https://sporthubmap.com";

export const revalidate = 3600;

type VenueRow = { slug: string; updated_at: string | null };
type ComboRow = {
  primary_sport_slug: string | null;
  country_code: string | null;
  city: { slug?: string } | null;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = getSupabaseServerClient();
  const now = new Date();

  // Pages statiques
  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/map`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  // Pages famille (point d'entrée vers le sport principal de chaque famille)
  const familyEntries: MetadataRoute.Sitemap = FAMILIES.map((family) => ({
    url: `${SITE_URL}/sports/${family.sports[0]}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Pages venue (cap à 50k pour rester dans la limite Google par sitemap file —
  // au-delà, split en sitemap-index via generateSitemaps())
  const { data: venuesData } = await sb
    .from("venue")
    .select("slug, updated_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .limit(50000);

  const venueEntries: MetadataRoute.Sitemap = ((venuesData as VenueRow[]) ?? []).map(
    (v) => ({
      url: `${SITE_URL}/venue/${v.slug}`,
      lastModified: v.updated_at ? new Date(v.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.8,
    }),
  );

  // Pages programmatiques (sport × pays × ville) — dédup en mémoire
  const { data: combosData } = await sb
    .from("venue")
    .select("primary_sport_slug, country_code, city:city_id ( slug )")
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("city_id", "is", null)
    .not("country_code", "is", null)
    .not("primary_sport_slug", "is", null)
    .limit(50000);

  const seenCombos = new Set<string>();
  const programmaticEntries: MetadataRoute.Sitemap = [];
  for (const row of (combosData as ComboRow[]) ?? []) {
    if (!row.primary_sport_slug || !row.country_code || !row.city?.slug) continue;
    const key = `${row.primary_sport_slug}/${row.country_code.toLowerCase()}/${row.city.slug}`;
    if (seenCombos.has(key)) continue;
    seenCombos.add(key);
    programmaticEntries.push({
      url: `${SITE_URL}/${key}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  return [
    ...staticEntries,
    ...familyEntries,
    ...venueEntries,
    ...programmaticEntries,
  ];
}
