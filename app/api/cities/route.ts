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
  const { data, error } = await sb
    .from("city")
    .select("slug, name, country_code")
    .ilike("name", `${safe}%`)
    .order("population", { ascending: false, nullsFirst: false })
    .limit(8);

  if (error) return NextResponse.json({ cities: [] });
  return NextResponse.json(
    { cities: (data ?? []) as CitySuggestion[] },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" } },
  );
}
