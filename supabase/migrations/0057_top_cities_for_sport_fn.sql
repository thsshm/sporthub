-- ════════════════════════════════════════════════════════════════════════
-- Migration 0057 : RPC top_cities_for_sport — villes les plus représentées
-- pour un sport donné, affichées sur la page /sports/[sport] (#604).
-- ════════════════════════════════════════════════════════════════════════
-- Requête GROUP BY sur mv_venue_sport_search (quality_score ≥ 25) × city.
-- Utilisée côté serveur avec revalidate=3600, pas d'impact perf sur la prod.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION top_cities_for_sport(
  p_sport_slug  text,
  p_limit       int DEFAULT 8
)
RETURNS TABLE (
  city_name    text,
  city_slug    text,
  country_code text,
  venue_count  bigint
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    c.name,
    c.slug,
    c.country_code,
    count(*)::bigint AS venue_count
  FROM mv_venue_sport_search m
  JOIN city c ON c.id = m.city_id
  WHERE m.sport_slug  = p_sport_slug
    AND m.quality_score >= 25
    AND m.city_id IS NOT NULL
  GROUP BY c.id, c.name, c.slug, c.country_code
  ORDER BY venue_count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION top_cities_for_sport(text, int) TO anon, authenticated;
