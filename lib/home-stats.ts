import { unstable_cache } from "next/cache";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { LOW_QUALITY_THRESHOLD } from "@/lib/venue/quality-score";
import {
  highConfidenceCardCount,
  MIN_HIGH_CONFIDENCE_CARDS,
} from "@/lib/seo/popular-search-gate";

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
/** Combo + son nombre de lieux fiables (affiché sur la home, #614). */
export type PopularComboWithCount = PopularCombo & { count: number };

/** Au-delà de ce nombre de lieux fiables, le combo porte un badge « couverture
 * élevée » (#614) — signal de confiance « beaucoup de spots ici ». */
export const HIGH_COVERAGE_FOR_POPULAR = 40;

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

/** Top de venues qualité fetché par combo avant de passer le gate (#699). Borné :
 * il suffit d'en avoir assez pour trouver ≥ seuil cards propres après group +
 * exclusion mismatch ; les court-level/misclassif sont souvent sous le seuil. */
const GATE_FETCH_LIMIT = 60;

/** Ligne minimale lue depuis mv_venue_sport_search pour le gate. */
type GateRow = {
  venue_id: string;
  name: string;
  lat: number;
  lon: number;
  courts_count: number | null;
  primary_sport_slug: string | null;
};

/** Filtre pur (testable) : ne garde que les combos avec ≥ `min` lieux. */
export function keepPopularCombos(
  withCount: { combo: PopularCombo; count: number }[],
  min: number,
): PopularComboWithCount[] {
  return withCount
    .filter((x) => x.count >= min)
    .map((x) => ({ ...x.combo, count: x.count }));
}

/**
 * Recherches populaires DATA-DRIVEN : on part d'une liste éditoriale puis on
 * NE GARDE QUE les combos sport×ville avec ≥ MIN_VENUES_FOR_POPULAR lieux
 * **≥ seuil qualité** (= réellement listés en SSR, #552). Évite d'envoyer
 * l'utilisateur sur une page vide / « No address » (#462, #552).
 *
 * count=exact ici : la requête est bornée par city_id → l'index composite
 * (primary_sport_slug, city_id) (migration 0005) rend le COUNT trivial. Client
 * static + unstable_cache → la home reste ISR.
 */
export const getPopularCombos = unstable_cache(
  async (): Promise<PopularComboWithCount[]> => {
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
        // GATE DURCI (#699) : on ne compte plus « venues ≥ seuil qualité » (qui
        // sur-comptait les enregistrements court-level et les misclassif), mais
        // les CARDS HAUTE CONFIANCE réellement affichées par la page ville =
        // après groupCourtRecords (#635) + exclusion des noms contradictoires
        // (#553). On fetche le top par qualité (déjà ≥ seuil) depuis la MV puis
        // on passe le gate pur. count exposé = nb réel de cards de confiance.
        // mv_venue_sport_search : MV → absente des types générés (cast `any`).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (sb as any)
          .from("mv_venue_sport_search")
          .select("venue_id, name, lat, lon, courts_count, primary_sport_slug")
          .eq("sport_slug", combo.sport)
          .eq("city_id", cityId)
          .gte("quality_score", LOW_QUALITY_THRESHOLD)
          .order("quality_score", { ascending: false })
          .limit(GATE_FETCH_LIMIT);
        const rows = ((data as GateRow[]) ?? []).map((r) => ({
          id: r.venue_id,
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          courts_count: r.courts_count,
          primary_sport_slug: r.primary_sport_slug,
        }));
        return { combo, count: highConfidenceCardCount(rows, combo.sport) };
      }),
    );

    return keepPopularCombos(withCount, MIN_HIGH_CONFIDENCE_CARDS);
  },
  ["home-popular-combos"],
  { revalidate: 300, tags: ["home"] },
);
