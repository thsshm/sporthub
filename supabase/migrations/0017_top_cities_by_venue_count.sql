-- RPC : top villes par nombre de venues publiées (section "Villes à explorer"
-- de la home). Remplace la sélection `is_featured` (curée, aujourd'hui DE/CZ)
-- par les villes réellement les plus actives — "villes avec le plus de spots".
--
-- Agrégat GROUP BY city via l'index venue(city_id) (idx_venue_sport_city /
-- city_id). ORDER BY count DESC LIMIT N. Appelé côté home dans un unstable_cache
-- (revalidate 300s) → s'exécute au plus une fois / 5 min, charge négligeable.

CREATE OR REPLACE FUNCTION top_cities_by_venue_count(max_results INTEGER DEFAULT 6)
RETURNS TABLE (
  id           UUID,
  slug         TEXT,
  name         TEXT,
  country_code TEXT,
  count        BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT c.id, c.slug, c.name, c.country_code, COUNT(v.id) AS count
  FROM city c
  JOIN venue v ON v.city_id = c.id
  WHERE v.is_published = TRUE
    AND v.deleted_at IS NULL
  GROUP BY c.id, c.slug, c.name, c.country_code
  ORDER BY count DESC
  LIMIT GREATEST(1, LEAST(max_results, 50));
$$;

GRANT EXECUTE ON FUNCTION top_cities_by_venue_count(INTEGER) TO anon, authenticated;
