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
