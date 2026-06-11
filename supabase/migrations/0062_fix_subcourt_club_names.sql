-- ════════════════════════════════════════════════════════════════════════
-- Migration 0062 : corrige les noms de clubs = étiquettes de sous-court (#497)
-- ════════════════════════════════════════════════════════════════════════
-- Le ranking /disciplines (mv_top_clubs_by_sport → club.name) affiche des noms
-- de sous-courts en tête (« Court de tennis 3 », « Terrain n°5 »…). Le nommage
-- est corrigé au clustering par #567, mais les clubs DÉJÀ créés gardent le
-- mauvais nom.
--
-- Pourquoi ce BACKFILL plutôt que reset+recluster : le reset NULLait
-- venue.club_id (écriture sur 26k lignes de la table venue, 267k) → bloqué par
-- les locks des imports concurrents (4 échecs de timeout, #572). Ici on n'écrit
-- QUE sur la table `club` (petite, non contendue) ; la lecture de `venue` ne
-- prend pas de lock (MVCC) → pas de blocage.
--
-- Conservateur : on ne renomme un club QUE si (a) son nom est clairement un
-- libellé de sous-court (mot d'équipement en tête + nombre final) ET (b) il
-- existe au moins une venue membre avec un VRAI nom (ni générique ni sous-court).
-- Le slug n'est pas touché (le nom AFFICHÉ est corrigé, c'est ce que lit le
-- ranking). Idempotent (re-jouable : un club déjà renommé ne matche plus).

SET LOCAL statement_timeout = 0;

WITH best AS (
  -- Meilleur nom de venue membre par club : le plus court parmi les noms
  -- significatifs (ni générique, ni étiquette de sous-court).
  SELECT DISTINCT ON (v.club_id) v.club_id, v.name
  FROM venue v
  WHERE v.club_id IS NOT NULL
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
  -- club dont le nom est une étiquette de sous-court numérotée
  AND lower(c.name) ~ '^(court|courts|terrain|terrains|piste|pistes|bassin|cours|kort)\y'
  AND c.name ~ '[0-9][[:space:]]*$';

-- Rafraîchit la MV du ranking /disciplines pour refléter les nouveaux noms.
REFRESH MATERIALIZED VIEW mv_top_clubs_by_sport;
