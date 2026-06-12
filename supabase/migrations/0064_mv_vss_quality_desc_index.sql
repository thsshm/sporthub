-- ════════════════════════════════════════════════════════════════════════
-- Migration 0064 : index DESC pour le tri de la liste /sports/[sport]
-- ════════════════════════════════════════════════════════════════════════
-- BUG : la page nationale /sports/<sport> (app/[locale]/sports/[sport]/page.tsx)
-- liste avec `ORDER BY quality_score DESC, venue_id ASC LIMIT 24`. L'index de la
-- 0056, `idx_mv_vss_sport_quality_vid (sport_slug, quality_score, venue_id)`, est
-- en ASC sur TOUTES les colonnes. Un index all-ASC ne peut servir un tri à
-- directions MIXTES (`quality_score DESC, venue_id ASC`) : Postgres doit alors
-- trier TOUTES les lignes du sport avant le LIMIT. Pour le plus gros sport (gym,
-- ~174k lignes) ce tri dépasse le statement_timeout du rôle anon → la liste
-- revient vide → page « No venue ». Les petits sports passent (tri court).
-- (Le commentaire de page.tsx affirmait à tort que l'index 0056 servait ce tri.)
--
-- Fix : un index dont l'ordre correspond EXACTEMENT au tri → le planner sort les
-- 24 premières lignes directement de l'index, sans trier 174k lignes.
-- CREATE INDEX non-concurrent prend un lock SHARE (bloque les écritures, PAS les
-- lectures) ; la MV n'est écrite qu'au refresh → sans impact sur les pages.
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_mv_vss_sport_quality_desc_vid
  ON mv_venue_sport_search (sport_slug, quality_score DESC, venue_id ASC);

ANALYZE mv_venue_sport_search;
