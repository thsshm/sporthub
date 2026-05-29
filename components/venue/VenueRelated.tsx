/**
 * "Voir aussi" — autres venues du même sport principal dans la même ville
 * (ou même famille à défaut). Limit 6. Server Component avec query Supabase
 * directe.
 *
 * Gracieux : si pas de candidat dans la ville, on ne montre rien. (L'élargissement
 * famille/géo est une optimisation future — éviter un bloc rempli au hasard
 * qui dilue le contexte.)
 */
import { getTranslations } from "next-intl/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { VenueCard } from "@/components/venue/VenueCard";
import type { VenuePin } from "@/lib/supabase/types";

type Props = {
  currentVenueId: string;
  cityId: string | null;
  primarySportSlug: string | null;
  familySlug: string;
};

type RelatedRow = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  family_slug: string;
  primary_sport_slug: string | null;
  address: string | null;
  courts_count: number | null;
  country_code: string | null;
  city?: { name?: string; country_code?: string } | null;
};

async function fetchRelated({
  currentVenueId,
  cityId,
  primarySportSlug,
  familySlug,
}: Props): Promise<RelatedRow[]> {
  if (!cityId) return [];
  const sb = getSupabaseServerClient();

  // 1) Même ville + même sport principal (best signal)
  let query = sb
    .from("venue")
    .select(
      `
      id, slug, name, lat, lon, family_slug, primary_sport_slug, address,
      courts_count, country_code,
      city:city_id ( name, country_code )
    `,
    )
    .eq("city_id", cityId)
    .neq("id", currentVenueId)
    .eq("is_published", true)
    .is("deleted_at", null)
    .limit(6);

  if (primarySportSlug) {
    query = query.eq("primary_sport_slug", primarySportSlug);
  } else {
    query = query.eq("family_slug", familySlug);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as RelatedRow[];
}

export async function VenueRelated(props: Props) {
  const related = await fetchRelated(props);
  if (related.length === 0) return null;

  const t = await getTranslations("venue");

  const items = related.map((v) => ({
    id: v.id,
    slug: v.slug,
    name: v.name,
    lat: v.lat,
    lon: v.lon,
    family_slug: v.family_slug,
    primary_sport_slug: v.primary_sport_slug,
    address: v.address,
    courts_count: v.courts_count,
    city_name: v.city?.name,
    country_code: v.country_code ?? v.city?.country_code ?? undefined,
  })) as (VenuePin & {
    city_name?: string;
    country_code?: string;
    address?: string | null;
    courts_count?: number | null;
  })[];

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">
        {t("relatedTitle")}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((venue) => (
          <VenueCard key={venue.id} venue={venue} />
        ))}
      </div>
    </section>
  );
}
