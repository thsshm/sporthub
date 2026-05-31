-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0012 : table `club` (vue club V1)
-- ════════════════════════════════════════════════════════════════════════
-- Contexte (issue #130, phase 2) :
--   Au zoom < 16, plutôt que d'afficher N pins individuels pour un même
--   établissement (ex. : 6 courts de tennis du même tennis-club, 4 cages de
--   crossfit dans la même salle), on agrège en 1 seul pin "club" plus gros
--   (42px) avec un badge `[N] courts`. Au zoom ≥ 16, les venues individuels
--   réapparaissent.
--
-- Choix de design :
--   - Table dédiée `club` plutôt qu'une vue matérialisée — on veut pouvoir
--     éditer un club indépendamment (name affiché, slug SEO) sans toucher
--     aux venues. Le clustering venue → club est fait offline par un script
--     batch (cf. scripts/cluster_clubs.py V1).
--   - `venue.club_id` nullable : un venue isolé (ex. : court municipal seul)
--     reste un pin individuel — il n'a pas besoin d'un club parent.
--   - PostGIS `geom` généré depuis lat/lon comme sur `venue` (cf. 0003).
--     Index GIST → requête bbox identique à `venues_in_bbox` côté API.
--   - RLS SELECT public : un club est une donnée publique, pas user-specific.
--     Pas de policy INSERT/UPDATE/DELETE — seul le service_role (scripts +
--     admin) modifie les clubs.
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- Table club
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE club (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,        -- "tennis-club-de-paris-16"
  family_slug   TEXT NOT NULL,                -- "raquette", "fitness", "yoga"…
  city_id       UUID REFERENCES city(id) ON DELETE SET NULL,
  country_code  TEXT REFERENCES country(code) ON DELETE SET NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  geom          GEOGRAPHY(POINT, 4326)
                  GENERATED ALWAYS AS (
                    ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
                  ) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index GIST sur geom : exploité par ST_Intersects / && ST_MakeEnvelope dans
-- l'endpoint /api/venues/clubs.
CREATE INDEX idx_club_geom ON club USING GIST(geom);

-- Filtrage par famille (UI : checkboxes par famille → WHERE family_slug IN (…)).
CREATE INDEX idx_club_family ON club(family_slug);

-- Filtrage par ville / pays (pages /sports/[sport]/[country]/[city] futures).
CREATE INDEX idx_club_city ON club(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX idx_club_country ON club(country_code) WHERE country_code IS NOT NULL;

-- Trigger updated_at (réutilise set_updated_at() déjà défini en 0001).
CREATE TRIGGER trg_club_updated_at BEFORE UPDATE ON club
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Lien venue → club
-- ────────────────────────────────────────────────────────────────────────
-- Nullable : un venue peut être indépendant (pas dans un établissement).
-- ON DELETE SET NULL : si on supprime un club, ses venues redeviennent
-- indépendants (pas de cascade qui détruirait les venues).

ALTER TABLE venue ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES club(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venue_club_id ON venue(club_id)
  WHERE club_id IS NOT NULL AND deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE club ENABLE ROW LEVEL SECURITY;

-- SELECT public : un club est une donnée publique (carte, fiches, sitemap).
CREATE POLICY "Lecture publique des clubs"
  ON club FOR SELECT
  USING (true);

-- Pas de policy INSERT/UPDATE/DELETE : modifications réservées au service_role
-- (script clustering batch + admin). Le service_role bypass RLS par défaut.
