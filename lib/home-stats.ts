import { unstable_cache } from "next/cache";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";

/**
 * Counts de venues publiées par famille — source unique partagée par le H1 de
 * la home (`app/[locale]/page.tsx`) ET la meta description (`layout.tsx`), pour
 * qu'ils ne divergent jamais (#334 : la meta annonçait 350000 hardcodé alors
 * que le H1 affichait le vrai total).
 *
 * `count=planned` (estimation via stats Postgres) plutôt que `count=exact` :
 * sur 200k+ venues (fitness) l'exact dépasse le statement_timeout → la home
 * affichait 0. `planned` est instantané, précision ±1% suffisante pour un compteur.
 *
 * Client `static` (pas de cookies()) + `unstable_cache` → la home reste
 * statique/ISR côté Vercel (cf. #191).
 */
export const getFamilyCounts = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const sb = getSupabaseStaticClient();
    const entries = await Promise.all(
      FAMILIES.map(async (f) => {
        try {
          const { count } = await sb
            .from("venue")
            .select("id", { count: "planned", head: true })
            .eq("family_slug", f.slug)
            .eq("is_published", true)
            .is("deleted_at", null);
          return [f.slug, count ?? 0] as const;
        } catch {
          // Une famille qui fail ne doit pas faire planter tout le compteur.
          return [f.slug, 0] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  },
  ["home-family-counts"],
  { revalidate: 300, tags: ["home"] },
);

/** Somme des counts familles (pure, testable). */
export function sumFamilyCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Total de spots publiés — même source que le H1 de la home. */
export async function getTotalSpots(): Promise<number> {
  return sumFamilyCounts(await getFamilyCounts());
}

// ─── Recherches populaires (sport × ville) — #462 ──────────────────────────

export type PopularCombo = { sport: string; citySlug: string; cityLabel: string };

/** Seuil minimum de lieux pour qu'un combo sport×ville soit affiché sur la home.
 * En dessous, la page programmatique est trop maigre (« No address ») → on la
 * retire des « recherches populaires » (audit produit #462). */
export const MIN_VENUES_FOR_POPULAR = 5;

/** Liste éditoriale de combos candidats (villes FR pertinentes). Filtrée à
 * l'exécution par le vrai nombre de lieux publiés (cf. getPopularCombos). */
const POPULAR_CANDIDATES: PopularCombo[] = [
  { sport: "padel", citySlug: "paris", cityLabel: "Paris" },
  { sport: "tennis", citySlug: "lyon", cityLabel: "Lyon" },
  { sport: "petanque", citySlug: "marseille", cityLabel: "Marseille" },
  { sport: "yoga", citySlug: "bordeaux", cityLabel: "Bordeaux" },
  { sport: "gym", citySlug: "toulouse", cityLabel: "Toulouse" },
  { sport: "boxing", citySlug: "nantes", cityLabel: "Nantes" },
  { sport: "padel", citySlug: "nice", cityLabel: "Nice" },
  { sport: "tennis", citySlug: "strasbourg", cityLabel: "Strasbourg" },
  { sport: "surf", citySlug: "biarritz", cityLabel: "Biarritz" },
  { sport: "kitesurf", citySlug: "la-rochelle", cityLabel: "La Rochelle" },
  { sport: "football", citySlug: "lille", cityLabel: "Lille" },
  { sport: "basketball", citySlug: "rennes", cityLabel: "Rennes" },
  // Combos à fort volume vérifiés en live (2026-06-08) — élargissent le vivier
  // pour que le filtre ≥5 ait de la matière (sinon la section ne montrait que
  // ~5 chips alors que ces pages comptent des dizaines à centaines de lieux). #462.
  { sport: "gym", citySlug: "paris", cityLabel: "Paris" }, // ~579
  { sport: "tennis", citySlug: "paris", cityLabel: "Paris" }, // ~68
  { sport: "gym", citySlug: "lyon", cityLabel: "Lyon" }, // ~164
  { sport: "tennis", citySlug: "bordeaux", cityLabel: "Bordeaux" }, // ~20
];

/** Filtre pur (testable) : ne garde que les combos avec ≥ `min` lieux. */
export function keepPopularCombos(
  withCount: { combo: PopularCombo; count: number }[],
  min: number,
): PopularCombo[] {
  return withCount.filter((x) => x.count >= min).map((x) => x.combo);
}

/**
 * Recherches populaires DATA-DRIVEN : on part d'une liste éditoriale puis on
 * NE GARDE QUE les combos sport×ville réellement peuplés (≥ MIN_VENUES_FOR_POPULAR
 * lieux publiés). Évite d'envoyer l'utilisateur sur des pages vides (#462).
 *
 * count=exact ici : la requête est bornée par city_id → l'index composite
 * (primary_sport_slug, city_id) (migration 0005) rend le COUNT trivial. Client
 * static + unstable_cache → la home reste ISR.
 */
export const getPopularCombos = unstable_cache(
  async (): Promise<PopularCombo[]> => {
    const sb = getSupabaseStaticClient();
    const citySlugs = [...new Set(POPULAR_CANDIDATES.map((c) => c.citySlug))];
    const { data: cities } = await sb
      .from("city")
      .select("id, slug")
      .in("slug", citySlugs);
    const cityIdBySlug = new Map(
      (cities ?? []).map((c) => [c.slug, c.id] as const),
    );

    const withCount = await Promise.all(
      POPULAR_CANDIDATES.map(async (combo) => {
        const cityId = cityIdBySlug.get(combo.citySlug);
        if (!cityId) return { combo, count: 0 };
        try {
          const { count } = await sb
            .from("venue")
            .select("id", { count: "exact", head: true })
            .eq("primary_sport_slug", combo.sport)
            .eq("city_id", cityId)
            .eq("is_published", true)
            .is("deleted_at", null);
          return { combo, count: count ?? 0 };
        } catch {
          return { combo, count: 0 };
        }
      }),
    );

    return keepPopularCombos(withCount, MIN_VENUES_FOR_POPULAR);
  },
  ["home-popular-combos"],
  { revalidate: 300, tags: ["home"] },
);
