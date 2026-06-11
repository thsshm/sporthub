-- ════════════════════════════════════════════════════════════════════════
-- Migration 0061 : reset one-off des clubs raquette (re-clustering propre #497)
-- ════════════════════════════════════════════════════════════════════════
-- Le ranking /disciplines (mv_top_clubs_by_sport → club.name) affiche des
-- noms de sous-courts (« Court de tennis 3 ») en tête. Le nommage est corrigé
-- au clustering par #567, MAIS import_clubs est ON CONFLICT (slug) DO NOTHING →
-- un re-run ne RENOMME pas les clubs existants ; il faut les vider d'abord, puis
-- relancer le clustering (workflow cluster-clubs) qui les recrée bien nommés.
--
-- Pourquoi un reset PAR MIGRATION (et pas via cluster_clubs.py --reset) :
-- le reset REST a échoué 3× sur le statement_timeout de 60s du rôle API (#572) —
-- la table venue (267k lignes) sous forte charge concurrente dépasse le cap.
-- `supabase db push` passe par une connexion DIRECTE (rôle admin, pas le cap API
-- 60s) → l'UPDATE/DELETE ci-dessous s'exécute sans timeout. venue.family_slug
-- est indexée (idx_venue_family) → l'UPDATE ciblé reste rapide.
--
-- Idempotent : re-jouable sans effet si raquette est déjà vide.

-- 1) Détache les venues raquette de leur club (lève la FK venue.club_id → club.id).
UPDATE venue
SET club_id = NULL
WHERE family_slug = 'raquette' AND club_id IS NOT NULL;

-- 2) Supprime les clubs raquette : le prochain run cluster-clubs (family=raquette,
--    reset=false) les recrée avec les noms corrigés (#567) puis rafraîchit la MV.
DELETE FROM club WHERE family_slug = 'raquette';
