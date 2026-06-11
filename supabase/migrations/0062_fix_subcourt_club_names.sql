-- ════════════════════════════════════════════════════════════════════════
-- Migration 0062 : corrige les noms de clubs = étiquettes de sous-court (#497)
-- ════════════════════════════════════════════════════════════════════════
-- Le ranking /disciplines (mv_top_clubs_by_sport → club.name) affiche des noms
-- de sous-courts en tête (« Court de tennis 3 », « Terrain n°5 »…). Le nommage
-- est corrigé au clustering par #567, mais les clubs DÉJÀ créés gardent le
-- mauvais nom.
--
-- BACKFILL plutôt que reset+recluster : le reset NULLait venue.club_id (écriture
-- sur 26k lignes de venue, 267k) → bloqué par les locks des imports concurrents
-- (4 timeouts, #572). Ici on n'écrit QUE sur `club` (petite, non contendue) ; la
-- lecture de venue ne prend pas de lock (MVCC).
--
-- Scopé RAQUETTE (la famille du problème /disciplines/tennis) → le scan de venue
-- reste petit (~47k via idx_venue_family) ; une 1re version tous-sports a été
-- annulée au cap CI 15 min (scan venue trop large sous charge). Le REFRESH de la
-- MV est volontairement HORS de cette migration (lui aussi scanne venue, donc
-- long sous charge) : il sera fait par le cron hebdo refresh-top-clubs ou
-- déclenché séparément au calme — la donnée club.name, elle, est corrigée ici.
--
-- Conservateur : renomme un club seulement si (a) son nom est une étiquette de
-- sous-court (mot d'équipement en tête + nombre final) ET (b) il a ≥ 1 venue
-- membre avec un vrai nom. Slug inchangé. Idempotent.

SET LOCAL statement_timeout = 0;

WITH best AS (
  SELECT DISTINCT ON (v.club_id) v.club_id, v.name
  FROM venue v
  WHERE v.club_id IS NOT NULL
    AND v.family_slug = 'raquette'
    AND v.name IS NOT NULL
    AND char_length(btrim(v.name)) >= 4
    AND NOT (
      lower(v.name) ~ '^(court|courts|terrain|terrains|piste|pistes|bassin|cours|kort)\y'
      AND v.name ~ '[0-9][[:space:]]*$'
    )
  ORDER BY v.club_id, char_length(btrim(v.name)), v.id
)
UPDATE club c
SET name = best.name
FROM best
WHERE c.id = best.club_id
  AND c.family_slug = 'raquette'
  AND lower(c.name) ~ '^(court|courts|terrain|terrains|piste|pistes|bassin|cours|kort)\y'
  AND c.name ~ '[0-9][[:space:]]*$';
