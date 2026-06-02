-- ════════════════════════════════════════════════════════════════════════
-- SportHub V2 — Migration 0029 : table retreat_event (modèle de données stages)
-- ════════════════════════════════════════════════════════════════════════
-- Issue #266. La famille « retraites » (/famille/retraites) affiche déjà les
-- venues + un panneau placeholder « Stages à venir ». Il manquait le MODÈLE de
-- données pour les stages/retraites datés (dates, prix, hébergement). Cette
-- migration crée la table, calquée sur la table V1 `retreat_events`
-- (data-pipeline/sportpin.sqlite) — qui existait en schéma mais était vide,
-- d'où l'absence de données à migrer : on pose ici l'infrastructure, le
-- remplissage (scrape / feed partenaire / saisie) est un chantier distinct.
--
-- Modèle :
--   - PK uuid (cohérent avec venue) ; (source, source_id) UNIQUE pour des
--     imports idempotents (upsert on_conflict).
--   - venue_id NULLABLE → FK venue ON DELETE SET NULL : un stage peut pointer
--     une venue de notre DB OU un lieu externe (venue_external_name/url).
--   - Champs calqués sur V1 (title, organizer, dates, lodging, pricing…).
--
-- RLS : activée. Lecture publique des stages publiés (mirroir de la policy
-- « Lecture publique des venues publiés » de 0001). Écriture = service_role.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS retreat_event (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id           TEXT UNIQUE,

  -- Rattachement lieu : interne (venue) et/ou externe (texte libre).
  venue_id            UUID REFERENCES venue(id) ON DELETE SET NULL,
  venue_external_name TEXT,
  venue_external_url  TEXT,

  -- Identité du stage.
  title               TEXT NOT NULL,
  organizer_name      TEXT,
  organizer_url       TEXT,

  -- Typage (aligné sur venue.retreat_type / RETREAT_TYPES côté app).
  sport_type          TEXT,
  experience_type     TEXT,
  level               TEXT,
  language            TEXT,
  audience            TEXT,

  -- Dates & récurrence.
  start_date          DATE,
  end_date            DATE,
  recurrence_pattern  TEXT,
  duration_nights     INTEGER CHECK (duration_nights IS NULL OR duration_nights >= 0),

  -- Capacité.
  capacity_total      INTEGER CHECK (capacity_total IS NULL OR capacity_total >= 0),
  spots_left          INTEGER CHECK (spots_left   IS NULL OR spots_left   >= 0),

  -- Prestations.
  includes_lodging    BOOLEAN,
  includes_meals      BOOLEAN,

  -- Tarif (montant en unités entières de la devise, défaut EUR).
  price_from_eur      INTEGER CHECK (price_from_eur IS NULL OR price_from_eur >= 0),
  price_currency      TEXT NOT NULL DEFAULT 'EUR',

  -- Réservation & contenu.
  booking_url         TEXT,
  description         TEXT,

  -- Cycle de vie : 'published' visible publiquement (cf. RLS), sinon masqué.
  status              TEXT NOT NULL DEFAULT 'draft',

  -- Géo & localisation textuelle (pour stages à lieu externe).
  lat                 DOUBLE PRECISION,
  lon                 DOUBLE PRECISION,
  city                TEXT,
  country             TEXT,

  raw_tags            JSONB,

  -- Provenance (idempotence d'import).
  source              TEXT,
  source_id           TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT retreat_event_dates_ck
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT retreat_event_source_uq
    UNIQUE (source, source_id)
);

-- Lookup principal : « stages publiés à venir », trié par date de début.
-- Partiel sur status='published' → index compact, sert la requête du panneau.
CREATE INDEX IF NOT EXISTS idx_retreat_event_upcoming
  ON retreat_event (start_date)
  WHERE status = 'published';

-- Stages d'une venue donnée (panneau sur la fiche venue, futur).
CREATE INDEX IF NOT EXISTS idx_retreat_event_venue
  ON retreat_event (venue_id)
  WHERE venue_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE retreat_event ENABLE ROW LEVEL SECURITY;

-- Lecture publique des stages publiés (mirroir venue).
-- DROP+CREATE car CREATE POLICY ne supporte pas IF NOT EXISTS → idempotence
-- (relance migration / db push CI).
DROP POLICY IF EXISTS "Lecture publique des stages publiés" ON retreat_event;
CREATE POLICY "Lecture publique des stages publiés"
  ON retreat_event FOR SELECT
  USING (status = 'published');
