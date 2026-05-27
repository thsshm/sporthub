-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Schema initial
-- ════════════════════════════════════════════════════════════════════════
-- À appliquer en premier sur un projet Supabase vide.
-- Coller dans Supabase Dashboard → SQL Editor → New query → Run.
-- Ou via CLI :  supabase db push
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy search sur les noms

-- ────────────────────────────────────────────────────────────────────────
-- Référentiels
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE country (
  code         TEXT PRIMARY KEY,        -- ISO 3166-1 alpha-2 : "FR", "ES"
  name_fr      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  emoji_flag   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sport (
  slug         TEXT PRIMARY KEY,        -- "tennis", "padel", "yoga"
  name_fr      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  family_slug  TEXT NOT NULL,           -- "raquette", "fitness", "yoga"…
  emoji        TEXT,
  color        TEXT,                     -- "#2d7a3e"
  position     INTEGER DEFAULT 100,      -- ordre d'affichage dans une famille
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sport_family ON sport(family_slug);

CREATE TABLE city (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT NOT NULL,           -- "paris"
  name          TEXT NOT NULL,           -- "Paris"
  country_code  TEXT NOT NULL REFERENCES country(code) ON DELETE CASCADE,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  population    INTEGER,
  is_featured   BOOLEAN DEFAULT false,   -- mis en avant sur /villes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, slug)
);
CREATE INDEX idx_city_country ON city(country_code);
CREATE INDEX idx_city_coords ON city(lat, lon);
CREATE INDEX idx_city_featured ON city(is_featured) WHERE is_featured = true;

CREATE TABLE amenity (
  slug         TEXT PRIMARY KEY,         -- "shower", "parking"
  name_fr      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  emoji        TEXT,                      -- "🚿"
  category     TEXT,                      -- "hygiene", "logistics", "comfort"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────
-- Entité centrale : venue
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE venue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,

  -- Géolocalisation
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  address         TEXT,
  city_id         UUID REFERENCES city(id) ON DELETE SET NULL,
  postal_code     TEXT,
  country_code    TEXT REFERENCES country(code) ON DELETE SET NULL,

  -- Contact
  website_url     TEXT,
  phone           TEXT,
  email           TEXT,

  -- Méta produit
  family_slug     TEXT NOT NULL,
  primary_sport_slug TEXT REFERENCES sport(slug) ON DELETE SET NULL,
  is_indoor       BOOLEAN,
  has_lighting    BOOLEAN,
  is_wheelchair_accessible BOOLEAN,

  -- Capacité
  courts_count    INTEGER,
  capacity        INTEGER,

  -- Pricing
  fee_required    BOOLEAN,
  price_range     TEXT,  -- "€", "€€", "€€€"

  -- Source d'origine + enrichissements
  source          TEXT NOT NULL,            -- "osm", "res", "wikidata", "editorial"
  external_id     TEXT,                      -- "osm/way/12345"
  enrichments     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Ex: { "wikipedia_url": "...", "photo_url": "...", "google_place_id": "...",
  --       "google_rating": 4.6, "google_rating_count": 123, "raw_tags": {...} }

  -- Lifecycle
  claimed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claim_status    TEXT NOT NULL DEFAULT 'unclaimed',  -- unclaimed | pending | verified
  is_published    BOOLEAN NOT NULL DEFAULT true,
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_venue_family ON venue(family_slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_venue_city ON venue(city_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_venue_country ON venue(country_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_venue_coords ON venue(lat, lon) WHERE deleted_at IS NULL;
CREATE INDEX idx_venue_source_extid ON venue(source, external_id);
CREATE INDEX idx_venue_published ON venue(is_published) WHERE deleted_at IS NULL;
CREATE INDEX idx_venue_claimed ON venue(claimed_by) WHERE claimed_by IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- Liaisons M:N
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE venue_sport (
  venue_id     UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  sport_slug   TEXT NOT NULL REFERENCES sport(slug) ON DELETE CASCADE,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  courts_count INTEGER,
  surface      TEXT,    -- "clay", "concrete", "synthetic", "grass"…
  PRIMARY KEY (venue_id, sport_slug)
);
CREATE INDEX idx_vs_sport ON venue_sport(sport_slug);
CREATE INDEX idx_vs_primary ON venue_sport(venue_id) WHERE is_primary = true;

CREATE TABLE venue_amenity (
  venue_id     UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  amenity_slug TEXT NOT NULL REFERENCES amenity(slug) ON DELETE CASCADE,
  detail       TEXT,
  PRIMARY KEY (venue_id, amenity_slug)
);

-- ────────────────────────────────────────────────────────────────────────
-- Booking & claims
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE booking_link (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id     UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  partner      TEXT NOT NULL,              -- "anybuddy", "playtomic", "tenup"
  url          TEXT NOT NULL,
  sport_slug   TEXT REFERENCES sport(slug) ON DELETE CASCADE,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venue_id, partner, sport_slug)
);
CREATE INDEX idx_booking_venue ON booking_link(venue_id) WHERE is_active = true;
CREATE INDEX idx_booking_partner ON booking_link(partner);

CREATE TABLE claim_request (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id           UUID NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  requester_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_email    TEXT NOT NULL,
  requester_name     TEXT,
  requester_role     TEXT,                  -- "owner", "manager", "marketing"
  proof_text         TEXT,
  proof_url          TEXT,                  -- vers Supabase Storage
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  notes              TEXT,                  -- notes admin internes
  reviewed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_claim_venue ON claim_request(venue_id);
CREATE INDEX idx_claim_status ON claim_request(status);
CREATE INDEX idx_claim_user ON claim_request(requester_user_id);

-- ────────────────────────────────────────────────────────────────────────
-- Triggers : auto-update du champ updated_at
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venue_updated_at BEFORE UPDATE ON venue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sport_updated_at BEFORE UPDATE ON sport
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) — sécurité par défaut
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE venue ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_sport ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_amenity ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_request ENABLE ROW LEVEL SECURITY;
-- Référentiels (sport, country, city, amenity) restent publics en lecture sans RLS

-- VENUE : lecture publique (uniquement publié + non supprimé)
CREATE POLICY "Lecture publique des venues publiés"
  ON venue FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

-- VENUE : édition uniquement par les admins (service_role) ou le propriétaire
CREATE POLICY "Édition par le propriétaire"
  ON venue FOR UPDATE
  USING (claimed_by = auth.uid() AND claim_status = 'verified');

-- VENUE_SPORT, VENUE_AMENITY, BOOKING_LINK : lecture publique (suivent venue)
CREATE POLICY "Lecture publique venue_sport" ON venue_sport FOR SELECT USING (true);
CREATE POLICY "Lecture publique venue_amenity" ON venue_amenity FOR SELECT USING (true);
CREATE POLICY "Lecture publique booking_link" ON booking_link FOR SELECT
  USING (is_active = true);

-- CLAIM_REQUEST : seul l'auteur voit sa demande ; tout user authentifié peut créer
CREATE POLICY "Lecture des claims par l'auteur"
  ON claim_request FOR SELECT
  USING (requester_user_id = auth.uid());

CREATE POLICY "Création de claim par tout user authentifié"
  ON claim_request FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ────────────────────────────────────────────────────────────────────────
-- Seed minimal : familles, sports, pays, amenities
-- (Permet de tester immédiatement, l'import V1 viendra par-dessus)
-- ────────────────────────────────────────────────────────────────────────

-- 13 familles (= sports principaux pour tester)
INSERT INTO country (code, name_fr, name_en, emoji_flag) VALUES
  ('FR', 'France', 'France', '🇫🇷'),
  ('ES', 'Espagne', 'Spain', '🇪🇸'),
  ('IT', 'Italie', 'Italy', '🇮🇹'),
  ('US', 'États-Unis', 'United States', '🇺🇸'),
  ('GB', 'Royaume-Uni', 'United Kingdom', '🇬🇧')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sport (slug, name_fr, name_en, family_slug, emoji, color, position) VALUES
  -- Raquette
  ('tennis',       'Tennis',       'Tennis',       'raquette', '🎾', '#2d7a3e', 1),
  ('padel',        'Padel',        'Padel',        'raquette', '🥎', '#2d7a3e', 2),
  ('table_tennis', 'Ping-pong',    'Table tennis', 'raquette', '🏓', '#2d7a3e', 3),
  ('badminton',    'Badminton',    'Badminton',    'raquette', '🏸', '#2d7a3e', 4),
  ('squash',       'Squash',       'Squash',       'raquette', '🎾', '#2d7a3e', 5),
  -- Ballon
  ('football',     'Football',     'Football',     'ballon',   '⚽', '#b45309', 1),
  ('basketball',   'Basket',       'Basketball',   'ballon',   '🏀', '#b45309', 2),
  ('handball',     'Handball',     'Handball',     'ballon',   '🤾', '#b45309', 3),
  ('volleyball',   'Volley',       'Volleyball',   'ballon',   '🏐', '#b45309', 4),
  ('rugby',        'Rugby',        'Rugby',        'ballon',   '🏉', '#b45309', 5),
  -- Fitness
  ('gym',          'Salle de sport','Gym',         'fitness',  '🏋️', '#7c3aed', 1),
  ('crossfit',     'CrossFit',     'CrossFit',     'fitness',  '💪', '#7c3aed', 2),
  ('hyrox',        'Hyrox',        'Hyrox',        'fitness',  '🔥', '#7c3aed', 3),
  ('pilates',      'Pilates',      'Pilates',      'fitness',  '🤸', '#7c3aed', 4),
  ('dance',        'Danse',        'Dance',        'fitness',  '💃', '#7c3aed', 5),
  -- Yoga / Bien-être
  ('yoga',         'Yoga',         'Yoga',         'yoga',     '🧘', '#db2777', 1),
  ('meditation',   'Méditation',   'Meditation',   'yoga',     '🕯️', '#db2777', 2),
  ('spa',          'Spa',          'Spa',          'yoga',     '💆', '#db2777', 3),
  ('sauna',        'Sauna',        'Sauna',        'yoga',     '♨️', '#db2777', 4),
  ('hammam',       'Hammam',       'Hammam',       'yoga',     '🛁', '#db2777', 5),
  -- Combat
  ('boxing',       'Boxe',         'Boxing',       'combat',   '🥊', '#b91c1c', 1),
  ('judo',         'Judo',         'Judo',         'combat',   '🥋', '#b91c1c', 2),
  ('karate',       'Karaté',       'Karate',       'combat',   '🥋', '#b91c1c', 3),
  ('mma',          'MMA',          'MMA',          'combat',   '🤼', '#b91c1c', 4),
  ('bjj',          'BJJ',          'BJJ',          'combat',   '🥋', '#b91c1c', 5),
  -- Boules
  ('petanque',     'Pétanque',     'Pétanque',     'boules',   '🟢', '#ca8a04', 1),
  ('boules',       'Boules lyonnaises','Lyonnaises','boules',  '⚪', '#ca8a04', 2),
  -- Baignade
  ('beach',        'Plage',        'Beach',        'baignade', '🏖️', '#0891b2', 1),
  ('pool',         'Piscine',      'Pool',         'baignade', '🏊', '#0891b2', 2),
  -- Glisse
  ('surf',         'Surf',         'Surf',         'glisse',   '🏄', '#0ea5e9', 1),
  ('kitesurf',     'Kitesurf',     'Kitesurfing',  'glisse',   '🪁', '#0ea5e9', 2),
  ('windsurf',     'Windsurf',     'Windsurfing',  'glisse',   '🌬️', '#0ea5e9', 3),
  ('sup',          'SUP',          'SUP',          'glisse',   '🚣', '#0ea5e9', 4),
  ('wakeboard',    'Wakeboard',    'Wakeboard',    'glisse',   '🌊', '#0ea5e9', 5),
  -- Nautique
  ('marina',       'Marina',       'Marina',       'nautique', '⛵', '#1e40af', 1),
  ('diving',       'Plongée',      'Diving',       'nautique', '🤿', '#1e40af', 2),
  ('lighthouse',   'Phare',        'Lighthouse',   'nautique', '🗼', '#1e40af', 3),
  -- Snow
  ('skiing',       'Ski alpin',    'Skiing',       'snow',     '⛷️', '#6366f1', 1),
  ('snowboarding', 'Snowboard',    'Snowboarding', 'snow',     '🏂', '#6366f1', 2),
  ('cross_country','Ski de fond',  'Cross-country','snow',     '🎿', '#6366f1', 3),
  -- Hike / Plein air & endurance
  ('trail',        'Sentier',      'Trail',        'hike',     '🥾', '#16a34a', 1),
  ('long_trail',   'GR',           'Long trail',   'hike',     '🚶', '#16a34a', 2),
  ('trailrun',     'Trail running','Trail run',    'hike',     '🏃', '#16a34a', 3),
  ('running',      'Course',       'Running',      'hike',     '👟', '#16a34a', 4),
  ('cycling',      'Vélo',         'Cycling',      'hike',     '🚴', '#16a34a', 5),
  ('mtb',          'VTT',          'MTB',          'hike',     '🚵', '#16a34a', 6),
  -- Plus
  ('golf',         'Golf',         'Golf',         'plus',     '⛳', '#6b7280', 1),
  ('equestrian',   'Équitation',   'Equestrian',   'plus',     '🐎', '#6b7280', 2),
  ('climbing_indoor','Escalade',   'Climbing',     'plus',     '🧗', '#6b7280', 3),
  ('archery',      'Tir à l''arc', 'Archery',      'plus',     '🏹', '#6b7280', 4),
  ('paragliding',  'Parapente',    'Paragliding',  'plus',     '🪂', '#6b7280', 5),
  -- Retraites
  ('yoga_retreat', 'Retraite yoga','Yoga retreat', 'retraites','🧘', '#be185d', 1),
  ('surf_camp',    'Surf camp',    'Surf camp',    'retraites','🏄', '#be185d', 2),
  ('wellness_retreat','Bien-être', 'Wellness',     'retraites','💆', '#be185d', 3)
ON CONFLICT (slug) DO NOTHING;

-- Amenities (équipements) standards
INSERT INTO amenity (slug, name_fr, name_en, emoji, category) VALUES
  ('shower',        'Douches',        'Showers',         '🚿', 'hygiene'),
  ('changing_room', 'Vestiaires',     'Changing rooms',  '👕', 'hygiene'),
  ('toilets',       'Toilettes',      'Toilets',         '🚽', 'hygiene'),
  ('parking',       'Parking',        'Parking',         '🅿️', 'logistics'),
  ('bike_parking',  'Parking vélo',   'Bike parking',    '🚲', 'logistics'),
  ('public_transit','Transports',     'Public transit',  '🚌', 'logistics'),
  ('reservation',   'Réservation',    'Booking',         '📅', 'service'),
  ('bar',           'Bar',            'Bar',             '☕', 'comfort'),
  ('restaurant',    'Restaurant',     'Restaurant',      '🍽️', 'comfort'),
  ('wifi',          'Wi-Fi',          'Wi-Fi',           '📶', 'comfort'),
  ('ac',            'Climatisation',  'AC',              '❄️', 'comfort'),
  ('heated',        'Chauffé',        'Heated',          '🔥', 'comfort'),
  ('sauna',         'Sauna',          'Sauna',           '♨️', 'wellness'),
  ('pro_shop',      'Pro shop',       'Pro shop',        '🛒', 'service'),
  ('coach',         'Coach',          'Coach',           '🧑‍🏫', 'service'),
  ('lighting',      'Éclairage',      'Lighting',        '🌙', 'feature'),
  ('indoor',        'Indoor',         'Indoor',          '🏠', 'feature'),
  ('wheelchair',    'PMR',            'Wheelchair access','♿', 'accessibility')
ON CONFLICT (slug) DO NOTHING;
