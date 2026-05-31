/**
 * Section "Top spots du moment" — venues les mieux notées.
 *
 * Query : SELECT … FROM venue WHERE enrichments->>'google_rating' IS NOT NULL
 *   ORDER BY (enrichments->>'google_rating')::numeric DESC NULLS LAST LIMIT 8.
 *
 * Si aucun rating en base, la section ne s'affiche pas (silencieusement).
 * On évite ainsi un fallback douteux qui afficherait des venues random.
 *
 * Server Component pur. Pas de map ici : on linke vers /venue/[slug].
 */
import { unstable_cache } from "next/cache";
import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { getFamilyColor, getFamilyEmoji } from "@/lib/families";

type TopSpotRow = {
  id: string;
  slug: string;
  name: string;
  family_slug: string;
  city: { name: string | null; country_code: string | null } | null;
  enrichments: {
    google_rating?: number;
    google_rating_count?: number;
  } | null;
};

const fetchTopSpots = unstable_cache(
  async (): Promise<TopSpotRow[]> => {
  const sb = getSupabaseStaticClient();
  try {
    // PostgREST n'expose pas trivialement un ORDER BY sur un cast jsonb→numeric.
    // En attendant une vue dédiée, on ramène les 200 venues les mieux notées
    // côté serveur (filtre is_published + non supprimé) et on retient celles
    // qui ont effectivement un google_rating en JSON.
    //
    // Note : ce n'est pas un vrai TOP N — les `rating` Google sont stockés
    // dans enrichments (jsonb), pas en colonne typée. Une future migration
    // ajoutera une colonne dénormalisée `google_rating numeric` pour pouvoir
    // ORDER BY en SQL pur (cf. issue dette technique).
    const { data } = await sb
      .from("venue")
      .select(
        `id, slug, name, family_slug, enrichments,
         city:city_id ( name, country_code )`,
      )
      .eq("is_published", true)
      .is("deleted_at", null)
      .not("enrichments->google_rating", "is", null)
      .limit(40);

    const rows = (data as TopSpotRow[] | null) ?? [];
    return rows
      .filter((r) => typeof r.enrichments?.google_rating === "number")
      .sort(
        (a, b) =>
          (b.enrichments?.google_rating ?? 0) -
          (a.enrichments?.google_rating ?? 0),
      )
      .slice(0, 8);
  } catch {
    return [];
  }
  },
  ["home-top-spots"],
  { revalidate: 300, tags: ["home"] },
);

export async function HomeTopSpots() {
  const t = await getTranslations("topSpots");
  const spots = await fetchTopSpots();

  if (spots.length === 0) return null;

  return (
    <section className="border-t">
      <div className="container mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
          <Link
            href="/map"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("viewAll")} →
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {spots.map((spot) => {
            const rating = spot.enrichments?.google_rating;
            const ratingCount = spot.enrichments?.google_rating_count;
            const familyColor = getFamilyColor(spot.family_slug);
            const familyEmoji = getFamilyEmoji(spot.family_slug);
            const cityName = spot.city?.name;
            const countryCode = spot.city?.country_code;
            return (
              <Link
                key={spot.id}
                href={`/venue/${spot.slug}`}
                className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
              >
                <div
                  className="h-1.5"
                  style={{ backgroundColor: familyColor }}
                  aria-hidden="true"
                />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 text-xl leading-none"
                      aria-hidden="true"
                    >
                      {familyEmoji}
                    </span>
                    <h3 className="line-clamp-2 flex-1 text-sm font-semibold leading-tight group-hover:underline">
                      {spot.name}
                    </h3>
                  </div>
                  {(cityName || countryCode) && (
                    <p className="mt-2 truncate text-xs text-muted-foreground">
                      {cityName}
                      {cityName && countryCode ? " · " : ""}
                      {countryCode}
                    </p>
                  )}
                  {typeof rating === "number" && (
                    <div className="mt-3 flex items-center gap-1 text-xs">
                      <Star
                        className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500"
                        aria-hidden="true"
                      />
                      <span className="font-medium">{rating.toFixed(1)}</span>
                      {typeof ratingCount === "number" && ratingCount > 0 && (
                        <span className="text-muted-foreground">
                          ({ratingCount})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
