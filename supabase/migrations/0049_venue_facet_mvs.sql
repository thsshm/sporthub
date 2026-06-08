-- ════════════════════════════════════════════════════════════════════════
-- Migration 0049 : vues matérialisées pour les facettes carte (#410)
-- ════════════════════════════════════════════════════════════════════════
-- venues_facets_in_bbox agrège en LIVE sur venue (~200k dans une bbox dense)
-- → timeout anon (57014) À FROID sur Paris/IDF (vérifié post-#420 : les index
-- composites ont aidé le chaud mais pas le froid). 3e correctif "agrégat live"
-- insuffisant après 0021 (CTE MATERIALIZED) et 0026.
--
-- STRATÉGIE (pattern #387) : précalculer les compteurs de facettes par cellule
-- de grille pour le CAS SANS FILTRE — c'est le cas cold-start qui timeout (1er
-- visiteur, aucun filtre actif). Le RPC (0050) lira ces MV quand fams/feat/
-- surfaces sont tous NULL, et retombera sur le chemin live (0026) dès qu'un
-- filtre est actif (rare, et le cache est chaud à ce moment-là).
--
-- ⚠️ La sémantique faceted-search (chaque compteur ignore SA dimension mais
-- applique les AUTRES filtres) dépend de la combinaison de filtres → non
-- précalculable globalement. On ne précalcule donc QUE le cas tous-NULL, où
-- chaque facette = simple compteur non filtré par dimension/valeur.
--
-- GRILLE = 1000 m (web-mercator 3857). Les facettes sont demandées au zoom ≥10
-- (vue serrée), donc grille FINE pour limiter l'inflation des compteurs par les
-- cellules de bord hors-vue. ⚠️ VALEUR À VALIDER CONTRE LA PROD : comparer les
-- counts MV vs live sur Paris/Lyon et arbitrer 1000 m ↔ taille de MV ↔ erreur
-- d'approximation acceptable pour des BADGES de compteurs (où ~approximatif est
-- tolérable). Cf. checklist de la PR.
--
-- Cette migration est ADDITIVE : elle ne touche pas le RPC (fait en 0050).
-- ════════════════════════════════════════════════════════════════════════

-- ── MV 1 : familles + critères (compteurs NON filtrés par cellule) ──────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_facet_grid AS
SELECT
  FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / 1000.0)::bigint AS cell_x,
  FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / 1000.0)::bigint AS cell_y,
  v.family_slug,
  COUNT(*)::bigint                                              AS n,
  COUNT(*) FILTER (WHERE v.has_lighting IS TRUE)::bigint        AS n_lit,
  COUNT(*) FILTER (WHERE v.is_indoor IS TRUE)::bigint           AS n_indoor,
  COUNT(*) FILTER (WHERE v.is_wheelchair_accessible IS TRUE)::bigint AS n_wheelchair,
  COUNT(*) FILTER (WHERE v.fee_required IS FALSE)::bigint       AS n_free,
  COUNT(*) FILTER (WHERE v.fee_required IS TRUE)::bigint        AS n_paid
FROM venue v
WHERE v.is_published = TRUE
  AND v.deleted_at IS NULL
  AND v.family_slug IS NOT NULL
GROUP BY 1, 2, 3;

-- UNIQUE → autorise REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_facet_grid_pk
  ON mv_venue_facet_grid (cell_x, cell_y, family_slug);

-- ── MV 2 : surfaces (COUNT DISTINCT venue par cellule × surface) ────────────
-- Une venue est dans UNE cellule (par sa geom) ; ses lignes venue_sport
-- (surfaces) y sont rattachées → SUM des compteurs par cellule = distinct
-- global sur la bbox, sans double-comptage inter-cellules. Réplique le
-- COUNT(DISTINCT bs.id) par surface du chemin live (0026).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_venue_facet_surface_grid AS
SELECT
  FLOOR(ST_X(ST_Transform(v.geom::geometry, 3857)) / 1000.0)::bigint AS cell_x,
  FLOOR(ST_Y(ST_Transform(v.geom::geometry, 3857)) / 1000.0)::bigint AS cell_y,
  vs.surface,
  COUNT(DISTINCT v.id)::bigint AS n
FROM venue v
JOIN venue_sport vs ON vs.venue_id = v.id
WHERE v.is_published = TRUE
  AND v.deleted_at IS NULL
  AND vs.surface IS NOT NULL
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_facet_surface_grid_pk
  ON mv_venue_facet_surface_grid (cell_x, cell_y, surface);

-- Lecture publique (compteurs agrégés, rien de privé).
GRANT SELECT ON mv_venue_facet_grid         TO anon, authenticated;
GRANT SELECT ON mv_venue_facet_surface_grid TO anon, authenticated;

-- ── Refresh : fonction dédiée + planification pg_cron (pattern #387) ────────
-- NON-concurrent (CONCURRENTLY dans une fonction échoue — cf. 0041) + un
-- statement_timeout local large (le refresh peut dépasser le cap ~8s du gateway
-- API → on le planifie en pg_cron côté base, comme refresh_venue_aggregates,
-- cf. 0044/0045). Lock AccessExclusive bref sur la MV pendant le refresh, sans
-- impact notable au créneau hebdo hors-pic.
CREATE OR REPLACE FUNCTION refresh_venue_facets()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_venue_facet_grid;
  REFRESH MATERIALIZED VIEW mv_venue_facet_surface_grid;
  -- CRITIQUE : ANALYZE après chaque REFRESH. Sans stats fraîches, le
  -- planificateur part en seq scan sur les plages de cellules larges (vues
  -- zoom 10-11) → re-timeout. Vérifié en prod : ANALYZE fait passer ces vues
  -- de timeout (froid) à ~200-400 ms (chaud). REFRESH ne met PAS à jour les
  -- stats → on les recalcule explicitement ici.
  ANALYZE mv_venue_facet_grid;
  ANALYZE mv_venue_facet_surface_grid;
END;
$$;

-- Planification pg_cron — lundi 09:15 UTC (juste après refresh_venue_aggregates
-- à 09:00, cf. 0045). pg_cron déjà installé par 0045 (idempotent ici).
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-venue-facets');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job inexistant → ignore
END $$;

SELECT cron.schedule(
  'refresh-venue-facets',
  '15 9 * * 1',
  $cmd$ SELECT public.refresh_venue_facets() $cmd$
);
