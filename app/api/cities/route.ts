import { NextResponse } from "next/server";
import { getSupabaseAnonEdgeClient } from "@/lib/supabase/server";

export const runtime = "edge";

export type CitySuggestion = {
  slug: string;
  name: string;
  country_code: string;
};

/**
 * Recherche de villes par nom (préfixe) sur notre table `city` (#640).
 *
 * Alimente l'autocomplete « chercher ma ville » des pages /sports/[sport].
 * Contrairement au SearchBar de la carte (géocodeur Nominatim → lat/lon), on
 * renvoie nos **slugs canoniques** pour construire l'URL programmatique
 * /[sport]/[country]/[city]. Tri par population (proxy de pertinence), cap 8.
 * `city` est une table de référence sans RLS → lisible en `anon`.
 */
export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ cities: [] });

  // Traite `q` comme littéral : échappe les wildcards LIKE.
  const safe = q.replace(/[\\%_]/g, "\\$&");
  const sb = getSupabaseAnonEdgeClient();
  // On récupère un sur-ensemble (population est quasi-NULL en base → tri PG peu
  // fiable : "Paris 01" remontait avant "Paris", "Lyoffans" avant "Lyon"), puis
  // on RE-CLASSE en JS par pertinence avant de couper à 8.
  const { data, error } = await sb
    .from("city")
    .select("slug, name, country_code, population")
    .ilike("name", `${safe}%`)
    .order("population", { ascending: false, nullsFirst: false })
    .limit(40);

  if (error) return NextResponse.json({ cities: [] });

  const ql = q.toLowerCase();
  const ranked = (data ?? [])
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      country_code: c.country_code,
      // Rang : match exact d'abord, puis nom le plus court ("Paris" < "Paris 01",
      // "Lyon" < "Lyoffans"), puis population décroissante, puis alpha.
      _exact: c.name.toLowerCase() === ql ? 0 : 1,
      _len: c.name.length,
      _pop: typeof c.population === "number" ? c.population : -1,
    }))
    .sort(
      (a, b) =>
        a._exact - b._exact ||
        a._len - b._len ||
        b._pop - a._pop ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8)
    .map(({ slug, name, country_code }) => ({ slug, name, country_code }));

  return NextResponse.json(
    { cities: ranked as CitySuggestion[] },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" } },
  );
}
