-- 0059 — Durcissement sécurité d'après le Security Advisor Supabase (43 warnings).
--
-- Triage (2026-06-11) :
--   1. « Function Search Path Mutable » — 5 fonctions sans `SET search_path` :
--      un rôle pouvant créer des objets dans un schéma du search_path pourrait
--      faire résoudre un nom de table/fonction vers le sien (hijack). On fige
--      `search_path = public` (style du repo, cf. 0038/0057). Les autres
--      fonctions (venues_in_bbox, venues_aggregates, import_clubs…) l'ont déjà.
--   2. « Materialized View in API » — les 9 MVs ont `GRANT SELECT TO anon` ;
--      SEULE `mv_venue_sport_search` est lue en direct par l'app via PostgREST
--      (`.from("mv_venue_sport_search")`, pages sport/ville + compteur commun).
--      Les 8 autres ne sont lues que par des RPC SECURITY DEFINER (droits du
--      owner) → on retire l'exposition API (REVOKE), zéro impact applicatif.
--   3. « Extension in Public » (postgis, pg_trgm, btree_gist) — ACCEPTÉ tel
--      quel : déplacer PostGIS hors de public est invasif (types geometry,
--      ST_*) et sans gain réel ici. Documenté, pas d'action.
--   NB : l'erreur « RLS Disabled » sur spatial_ref_sys (table système PostGIS,
--   owner supabase_admin → RLS impossible) a été traitée par REVOKE direct le
--   2026-06-11 ; le REVOKE est répété ici (idempotent) pour le versionner.
--
-- Idempotent : ALTER/REVOKE re-jouables sans effet si déjà appliqués.

-- 1) search_path figé sur les 5 fonctions restantes ------------------------
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.update_venue_geom() SET search_path = public;
ALTER FUNCTION public.top_cities_by_venue_count(integer) SET search_path = public;
ALTER FUNCTION public.top_cities_for_sport(text, int) SET search_path = public;
ALTER FUNCTION public.top_clubs_by_sport(text, integer) SET search_path = public;

-- 2) MVs : retirer l'exposition PostgREST sauf mv_venue_sport_search --------
REVOKE SELECT ON public.mv_disciplines_ranking      FROM anon, authenticated;
REVOKE SELECT ON public.mv_top_cities_by_venue_count FROM anon, authenticated;
REVOKE SELECT ON public.mv_top_clubs_by_sport        FROM anon, authenticated;
REVOKE SELECT ON public.mv_venue_country_agg         FROM anon, authenticated;
REVOKE SELECT ON public.mv_venue_facet_grid          FROM anon, authenticated;
REVOKE SELECT ON public.mv_venue_facet_surface_grid  FROM anon, authenticated;
REVOKE SELECT ON public.mv_venue_grid_agg            FROM anon, authenticated;
REVOKE SELECT ON public.mv_venue_sport_grid_agg      FROM anon, authenticated;
-- mv_venue_sport_search : GRANT conservé (lecture directe PostgREST par l'app).

-- 3) spatial_ref_sys : versionne le REVOKE déjà appliqué (advisor error) ----
REVOKE ALL ON TABLE public.spatial_ref_sys FROM anon, authenticated;

-- Recharge le cache PostgREST pour matérialiser les changements de grants.
NOTIFY pgrst, 'reload schema';
