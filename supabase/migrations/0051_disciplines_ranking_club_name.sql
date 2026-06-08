-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0051 : meilleur choix du nom représentatif du club
-- ════════════════════════════════════════════════════════════════════════
-- Bug constaté en prod sur /disciplines/tennis :
--   #1 "Bassin Aquatique" (Agde, 37 courts)
--   #2 "courts recouvrables 4"
--   #9 "Mur d'entraînement"
--   #10 "Terrain de Tennis n°4"
--
-- Cause (0035) : le représentant du groupe (sport, ville, adresse) était choisi
-- par ORDER BY v.id — donc arbitrairement un sous-terrain dont le libellé RES
-- est une étiquette technique ("Court n°4", "Courts terre battue 3").
--
-- Les noms de clubs propres sont typiquement plus COURTS (pas de numéro de
-- terrain en suffixe) et ne correspondent pas au pattern générique
-- court/terrain/mur/bassin suivi d'un chiffre.
--
-- Fix : dans le ROW_NUMBER(), on trie d'abord par :
--   1. Présence de club_id (un venue lié à un club a plus de chances d'avoir le
--      nom du club, pas d'un sous-terrain).
--   2. Absence de pattern générique : noms qui NE finissent PAS par un chiffre
--      ou un suffixe de type « …court N / terrain N / Nº N ».
--   3. Longueur du nom ASC : les noms de clubs sont plus courts (sans numéro)
--      que les étiquettes de sous-terrain.
--   4. id en tiebreak (stable, reproductible).
--
-- La logique pure du classement (courts_count, top-50, index) est inchangée.
-- RPC `top_discipline_venues` et cron `refresh_disciplines_ranking_mv` inchangés.
-- Idempotent : DROP + CREATE (même pattern que 0035).
-- ════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_disciplines_ranking;

CREATE MATERIALIZED VIEW mv_disciplines_ranking AS
  WITH per_sport AS (
    SELECT
      vs.sport_slug,
      v.id,
      v.slug,
      v.name,
      v.address,
      v.country_code,
      v.club_id,
      c.name AS city_name,
      -- Courts_count par sport (inchangé vs 0035).
      COUNT(*) OVER (
        PARTITION BY
          vs.sport_slug,
          v.city_id,
          lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
      )::INTEGER AS courts_count,
      -- Représentant "club-like" dans le groupe (sport, ville, adresse).
      -- Tri :
      --   1. club_id IS NOT NULL → venue déjà rattaché à un club = meilleur nom.
      --   2. Nom ne finit PAS par un chiffre ou un numéro de sous-terrain
      --      (pattern "…court 2", "…terrain 3", "…N°4", "… 12").
      --   3. Longueur du nom ASC (nom de club court > étiquette de sous-terrain).
      --   4. id tiebreak.
      ROW_NUMBER() OVER (
        PARTITION BY
          vs.sport_slug,
          v.city_id,
          lower(btrim(regexp_replace(v.address, '\s+', ' ', 'g')))
        ORDER BY
          -- 1. Préférer les venues avec un club_id (nom de club fiable).
          (CASE WHEN v.club_id IS NOT NULL THEN 0 ELSE 1 END),
          -- 2. Éviter les libellés de sous-terrain : nom qui SE TERMINE par un
          --    chiffre ou par un pattern "N°/no/court/terrain/mur + chiffre".
          --    Regex insensible à la casse :
          --      - finit par un chiffre seul (ex. "Court de tennis 2")
          --      - finit par "N°N" / "NºN" / "no.N" (ex. "Terrain N°4")
          --    0 = nom propre (pas de chiffre final), 1 = libellé de sous-terrain.
          (CASE WHEN v.name ~* '\s+\d+$|n[°º]?\s*\d+$|num[eé]ro\s*\d+$' THEN 1 ELSE 0 END),
          -- 3. Longueur ASC : "Tennis Club Paris" (17) < "Court extérieur 2" (18).
          length(v.name),
          -- 4. Tiebreak stable.
          v.id
      ) AS dedup_rn
    FROM venue v
    JOIN venue_sport vs ON vs.venue_id = v.id
    LEFT JOIN city c ON c.id = v.city_id
    WHERE v.is_published = TRUE
      AND v.deleted_at IS NULL
      AND vs.sport_slug IN ('tennis', 'padel', 'table_tennis', 'badminton', 'squash')
      AND v.city_id IS NOT NULL
      AND v.address IS NOT NULL
      AND btrim(v.address) <> ''
  ),
  clubs AS (
    SELECT sport_slug, id, slug, name, address, country_code, city_name, courts_count
    FROM per_sport
    WHERE dedup_rn = 1
  ),
  ranked AS (
    SELECT
      sport_slug, id, slug, name, address, country_code, courts_count, city_name,
      ROW_NUMBER() OVER (
        PARTITION BY sport_slug
        ORDER BY courts_count DESC, id
      ) AS rank
    FROM clubs
  )
  SELECT sport_slug, id, slug, name, address, country_code, courts_count, city_name, rank
  FROM ranked
  WHERE rank <= 50;

-- Index UNIQUE (pour futur REFRESH CONCURRENTLY) + index de lecture.
CREATE UNIQUE INDEX IF NOT EXISTS mv_disciplines_ranking_pk
  ON mv_disciplines_ranking (sport_slug, id);
CREATE INDEX IF NOT EXISTS mv_disciplines_ranking_lookup
  ON mv_disciplines_ranking (sport_slug, rank);

GRANT SELECT ON mv_disciplines_ranking TO anon, authenticated;
