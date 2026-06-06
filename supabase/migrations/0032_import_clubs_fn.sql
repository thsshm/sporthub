-- ════════════════════════════════════════════════════════════════════════
-- Migration 0032 : fonction import_clubs(jsonb) — écriture batch des clubs
-- ════════════════════════════════════════════════════════════════════════
-- Contexte (#311 / #130) :
--   Le peuplement de la table `club` via cluster_clubs.py faisait ~1 requête
--   REST par club (INSERT) + ~1 par lien venue → des dizaines de milliers de
--   requêtes séquentielles contre la prod. Sous charge, les POST /club ont
--   pris des statement_timeout (57014) → le run échouait, et la reprise
--   regaspillait 30 min à re-confirmer les clubs existants.
--
--   Cette fonction déplace les écritures **côté serveur** : le script Python
--   garde le clustering en mémoire (rapide), puis envoie les clubs par lots
--   (~250) à `import_clubs`. Chaque appel insère le lot + lie les venues en
--   UNE transaction server-side → minutes au lieu d'heures, et pas de
--   round-trip réseau par ligne.
--
--   Idempotente : ON CONFLICT (slug) DO NOTHING + UPDATE … WHERE club_id IS
--   NULL → un re-run ne duplique pas et ne réécrase pas un lien existant.
--   Si un lot time out, il roll back atomiquement → le script peut le rejouer.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION import_clubs(p_clubs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  v_club_id  uuid;
  v_vids     uuid[];
  v_inserted int := 0;
  v_linked   int := 0;
  n          int;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(p_clubs) AS value
  LOOP
    -- Insert du club (idempotent sur le slug).
    INSERT INTO club (slug, name, family_slug, lat, lon, city_id, country_code)
    VALUES (
      rec->>'slug',
      rec->>'name',
      rec->>'family_slug',
      (rec->>'lat')::double precision,
      (rec->>'lon')::double precision,
      NULLIF(rec->>'city_id', '')::uuid,
      NULLIF(rec->>'country_code', '')
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_club_id;

    IF v_club_id IS NULL THEN
      -- slug déjà présent (re-run) → récupère l'id existant pour lier les venues.
      SELECT id INTO v_club_id FROM club WHERE slug = rec->>'slug';
    ELSE
      v_inserted := v_inserted + 1;
    END IF;

    IF v_club_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Liens venue → club (ne réécrase jamais un club_id déjà posé).
    SELECT array_agg(elem::uuid)
      INTO v_vids
      FROM jsonb_array_elements_text(rec->'venue_ids') AS elem;

    IF v_vids IS NOT NULL THEN
      UPDATE venue
         SET club_id = v_club_id
       WHERE id = ANY(v_vids)
         AND club_id IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      v_linked := v_linked + n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'linked', v_linked);
END;
$$;

-- Écriture réservée au service_role (scripts batch + admin). Jamais anon/auth :
-- cette fonction modifie `club` et `venue`.
REVOKE ALL ON FUNCTION import_clubs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_clubs(jsonb) TO service_role;
