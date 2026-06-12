-- ════════════════════════════════════════════════════════════════════════
-- Migration 0063 : ANALYZE mv_venue_sport_search (stats planner)
-- ════════════════════════════════════════════════════════════════════════
-- Incident 2026-06-11 : après un verrou ACCESS EXCLUSIVE pendu sur la MV (un
-- REFRESH orphelin, débloqué par pg_terminate_backend) + la valse de
-- refresh/locks concurrents, les stats du planner sur mv_venue_sport_search
-- sont restées bancales. Conséquence : la requête de liste du PLUS GROS sport
-- (gym, ~174k lignes) sur la page nationale /sports/gym repassait sur un
-- mauvais plan → timeout sous le rôle anon → page « No venue » (les pages
-- ville, sous-ensembles plus petits, passaient). Même classe que 0060.
--
-- Fix : un ANALYZE explicite remet le planner d'aplomb. ANALYZE prend un
-- SHARE UPDATE EXCLUSIVE — il NE bloque PAS les lectures (contrairement au
-- REFRESH), donc sûr à appliquer même hors creux.
-- ════════════════════════════════════════════════════════════════════════

ANALYZE mv_venue_sport_search;
