import type { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Compteur de venues « visibles » pour un sport — SOURCE COMMUNE (#556).
 *
 * Trois compteurs coexistent dans l'app, chacun avec une sémantique propre
 * (documentée ici pour qu'aucune surface n'invente la sienne) :
 *
 *   1. **Home (par famille)** — `lib/home-stats.ts::getFamilyCounts` : TOTAL des
 *      venues publiées par famille, SANS filtre qualité. C'est le volume de la
 *      base (H1 marketing), pas ce qui est listé.
 *   2. **Pages sport / sport×ville (listes SEO)** — CE helper : appartenance au
 *      sport via `mv_venue_sport_search` ({primary} ∪ venue_sport, #476), donc
 *      une venue multi-sport compte sur TOUTES ses pages sport. Optionnellement
 *      filtré par ville et/ou seuil qualité (#464).
 *   3. **Carte** — exhaustive (API /api/venues), aucune ne filtre la qualité.
 *
 * `exact: true` (défaut) pour les scopes bornés (ville) ; `planned` pour les
 * scopes non bornés (page sport nationale — l'estimation du planner suffit et
 * évite un COUNT(*) sur 174k lignes, cf. page /sports/[sport]).
 */
export async function getVisibleVenueCount(
  sb: ReturnType<typeof getSupabaseServerClient>,
  opts: {
    sportSlug: string;
    cityId?: string;
    minQualityScore?: number;
    exact?: boolean;
  },
): Promise<number> {
  // mv_venue_sport_search est une vue matérialisée → absente des types Supabase
  // générés ; cast `any` localisé (même pattern que /sports/[sport]).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb as any)
    .from("mv_venue_sport_search")
    .select("venue_id", { count: opts.exact === false ? "planned" : "exact", head: true })
    .eq("sport_slug", opts.sportSlug);
  if (opts.cityId) q = q.eq("city_id", opts.cityId);
  if (opts.minQualityScore != null) q = q.gte("quality_score", opts.minQualityScore);
  const { count, error } = await q;
  if (error) {
    // NE PAS avaler en silence : une erreur ici (typiquement un statement_timeout
    // sur un COUNT(*) exact mal indexé) se déguiserait en « page légitimement
    // vide » et passerait inaperçue (cf. bug gym×ville 0058). On loggue pour la
    // rendre visible (logs Vercel / Sentry) tout en conservant le fallback 0.
    console.error(
      `[getVisibleVenueCount] sport=${opts.sportSlug} city=${opts.cityId ?? "—"} ` +
        `exact=${opts.exact !== false} → ${error.message ?? error.code ?? error}`,
    );
    return 0;
  }
  return count ?? 0;
}
