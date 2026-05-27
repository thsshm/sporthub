-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0003 : PostGIS pour requêtes spatiales rapides
-- ════════════════════════════════════════════════════════════════════════
-- À appliquer APRÈS que la table venue contienne déjà ses lignes (import V1
-- terminé). PostGIS sur un dataset peuplé est ~100× plus rapide pour les
-- requêtes "venues dans cette bbox" / "venues dans 5 km".
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE venue ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326);

UPDATE venue
SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
WHERE geom IS NULL;

CREATE INDEX IF NOT EXISTS idx_venue_geom ON venue USING gist(geom);

-- Trigger : auto-update geom à chaque INSERT/UPDATE de lat/lon
CREATE OR REPLACE FUNCTION update_venue_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lon IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_venue_geom ON venue;
CREATE TRIGGER trg_venue_geom BEFORE INSERT OR UPDATE OF lat, lon ON venue
  FOR EACH ROW EXECUTE FUNCTION update_venue_geom();

-- Exemple de requête optimisée par PostGIS (à conserver en commentaire pour ref) :
--
-- -- Venues dans un rayon de 5 km autour de Paris :
-- SELECT id, name, ST_Distance(geom, ST_MakePoint(2.3522, 48.8566)::geography) AS dist_m
-- FROM venue
-- WHERE ST_DWithin(geom, ST_MakePoint(2.3522, 48.8566)::geography, 5000)
--   AND is_published = true AND deleted_at IS NULL
-- ORDER BY dist_m
-- LIMIT 50;
--
-- -- Venues dans une bbox (coin SW + coin NE) :
-- SELECT id, name FROM venue
-- WHERE geom && ST_MakeEnvelope(2.20, 48.78, 2.55, 48.95, 4326)::geography
--   AND is_published = true AND deleted_at IS NULL;
