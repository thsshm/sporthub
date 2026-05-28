-- Indexes de perf pour les pages liste lourdes
--
-- Sans ces indexes, /[sport]/[country]/[city] (query : primary_sport_slug + city_id)
-- timeout sur 348k venues. Avec, < 100ms.

CREATE INDEX IF NOT EXISTS idx_venue_primary_sport
  ON venue (primary_sport_slug)
  WHERE deleted_at IS NULL AND is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_venue_sport_city
  ON venue (primary_sport_slug, city_id)
  WHERE deleted_at IS NULL AND is_published = TRUE;

-- Pour /admin/venues qui order par updated_at desc → on aurait pu order=id mais
-- l'admin veut souvent voir les modifs récentes. Ajoute un index utile pour
-- (deleted_at IS NULL) + sort updated_at desc.
CREATE INDEX IF NOT EXISTS idx_venue_updated_at_desc
  ON venue (updated_at DESC)
  WHERE deleted_at IS NULL;
