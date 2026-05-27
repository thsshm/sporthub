# SportHub V2 — Data Model

> Schéma Postgres détaillé. La source de vérité reste les migrations SQL dans
> `supabase/migrations/`. Ce document explique les **invariants**, les
> **décisions de design** et les **patterns d'usage**.

## Vue d'ensemble

```
        ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
        │   country   │    │     sport    │    │    amenity   │
        │ (ISO codes) │    │ (sport list) │    │ (equipments) │
        └──────┬──────┘    └──────┬───────┘    └──────┬───────┘
               │                  │                   │
        ┌──────▼──────┐           │                   │
        │     city    │           │                   │
        │ (FR cities) │           │                   │
        └──────┬──────┘           │                   │
               │                  │                   │
               │      ┌───────────▼─────────┐  ┌──────▼──────────┐
               └─────►│      venue          │◄─┤ venue_amenity   │
                      │ (le LIEU sportif)   │  │ (M:N venue×am.) │
                      └─────┬───────────────┘  └─────────────────┘
                            │
            ┌───────────────┼────────────────────┐
            │               │                    │
       ┌────▼───────┐  ┌────▼────────┐  ┌────────▼────────┐
       │venue_sport │  │booking_link │  │ claim_request   │
       │(M:N venue× │  │ (Anybuddy,  │  │  (clubs qui     │
       │  sport)    │  │  Playtomic) │  │  revendiquent)  │
       └────────────┘  └─────────────┘  └─────────────────┘
```

## Tables référentielles (en lecture seule pour le frontend)

### `country` — ISO 3166-1
- **PK** : `code` (TEXT, 2 lettres) — "FR", "ES"
- Seedé en migration 0001 avec 5 pays principaux. L'import V1 ajoute les pays vus dans la data.

### `sport` — Catalogue des sports
- **PK** : `slug` (TEXT) — "tennis", "padel"
- **Pourquoi un slug-PK et pas un UUID** : urls SEO + relations stables (un sport ne change jamais d'id).
- `family_slug` regroupe les sports (raquette, fitness, …). C'est de la dénormalisation contrôlée pour faciliter les requêtes "tous les sports raquette".
- `position` ordonne les sports dans une famille pour l'UI (chips de filtre dans l'ordre attendu).

### `city` — Villes principales
- Seules les villes avec **≥ 3 spots** sont créées par l'import V1 (sinon pollution).
- `is_featured = true` pour villes avec ≥ 100 spots → affichées en avant sur `/villes`.
- **Slug unique par pays** : `(country_code, slug)` UNIQUE. Permet `paris` à la fois en FR et US.

### `amenity` — Équipements normalisés
- 18 amenities seedées : douches, parking, sauna, etc.
- `category` permet de grouper l'affichage UI (hygiene / logistics / comfort / wellness…).

## Entité centrale : `venue`

> Un `venue` représente **un lieu physique** où on peut pratiquer du sport : club, gymnase, parc, plage, complexe.
> Ce n'est PAS un terrain individuel ni une session. Pour ça, on aurait besoin d'une table `installation` ou `session` (Phase 5+).

### Invariants

- `slug` est unique GLOBAL (pas par pays). Pour éviter `tennis-club` à plusieurs endroits, on suffixe avec ville ou external_id court.
- `lat`/`lon` non nuls toujours (sinon impossible à afficher sur carte).
- `family_slug` non nul : un venue appartient à exactement UNE famille (mais peut avoir N sports via `venue_sport`).
- `primary_sport_slug` est le sport principal — utilisé pour l'emoji du pin sur la carte.
- `is_published = false` cache le venue de la lecture publique (utile pour modération).
- `deleted_at IS NOT NULL` = soft-deleted (jamais de DELETE physique).

### Champ `enrichments` (JSONB)

Volontairement souple, pour ne pas devoir ajouter une colonne à chaque nouvelle source.

```json
{
  "wikipedia_url": "https://fr.wikipedia.org/wiki/Roland-Garros",
  "wikipedia_label": "Stade Roland-Garros",
  "photo_url": "https://upload.wikimedia.org/...",
  "google_place_id": "ChIJ...",
  "google_rating": 4.6,
  "google_rating_count": 12450,
  "google_cached_at": "2026-05-01T10:00:00Z",
  "raw_tags": { "...": "..." },           // dump OSM tags pour audit
  "v1_club_id": "club-fr-75016-raquette-roland-garros"  // pour traçabilité migration
}
```

Schéma libre — documenter les clés ajoutées ici dans ce fichier au fur et à mesure.

### Champ `source` + `external_id`

Permet de tracer l'origine d'un venue et de le refresher :

| source | external_id format | exemple |
|---|---|---|
| `osm` | `osm/<type>/<id>` | `osm/way/16346697` |
| `res` | `res/<inst_numero>` | `res/12345` |
| `wikidata` | `wikidata/Q<id>` | `wikidata/Q47457` |
| `editorial` | `editorial/<slug>` | `editorial/roland-garros-paris` |
| `v1-import` | `<v1_club_id>` | `club-fr-75016-raquette-roland-garros` |

`(source, external_id)` n'est pas UNIQUE car le même venue peut apparaître via plusieurs sources (deduplication par lat/lon + nom dans la pipeline).

## Liaison M:N : `venue_sport`

Un venue peut pratiquer plusieurs sports (gym multi-discipline, club tennis+padel).

- **PK composite** : `(venue_id, sport_slug)`
- `is_primary = true` pour 1 seul sport par venue (utilisé pour l'emoji pin)
- `courts_count` peut différer du `venue.courts_count` global :
  - Au niveau venue : nombre total de "courts/installations"
  - Au niveau venue_sport : nombre dédié à ce sport (ex: 4 tennis + 2 padel)
- `surface` est par sport (un club tennis a 4 terrains en terre battue + 2 en dur)

## Liaison M:N : `venue_amenity`

- **PK composite** : `(venue_id, amenity_slug)`
- `detail` libre : "200 places" pour parking, "50 m olympique" pour pool

## Booking & claims

### `booking_link`
Permet de proposer plusieurs partenaires par venue, optionnellement scopés par sport (un club avec tennis ET padel peut booker tennis sur Tenup et padel sur Anybuddy).

- `(venue_id, partner, sport_slug)` UNIQUE — empêche doublons
- `is_active = false` pour archiver un lien obsolète sans le supprimer

### `claim_request`
Workflow simple : un user demande, un admin review.

- `status` : `pending` → `approved` (met à jour `venue.claim_status = 'verified'` + `venue.claimed_by`) ou `rejected` (notes pour expliquer)
- `proof_url` pointe vers Supabase Storage (PDF / image)
- RLS : seul l'auteur voit sa propre demande (`requester_user_id = auth.uid()`). Les admins voient tout via service_role key côté admin dashboard.

## Indexes critiques

### Indexes B-tree (créés en migration 0001)
- `idx_venue_family` → filtre "tous les venues raquette"
- `idx_venue_city` → "tous les venues à Paris"
- `idx_venue_coords` → recherche par bbox approximative
- `idx_venue_published` → filtre rapide is_published

### Indexes PostGIS (migration 0003)
- `idx_venue_geom` (GIST) → requêtes spatiales 100× plus rapides
  - "venues dans 5 km autour de [lat, lon]"
  - "venues dans cette bbox carte"

### Index full-text (migration 0002, optionnel)
- `idx_venue_name_trgm` (GIN, pg_trgm) → recherche fuzzy par nom

## Patterns d'usage typiques

### Venues à afficher sur la carte (bbox + sport filter)
```sql
SELECT v.id, v.slug, v.name, v.lat, v.lon, v.primary_sport_slug, v.family_slug,
       v.courts_count, vs.surface
FROM venue v
JOIN venue_sport vs ON vs.venue_id = v.id
WHERE v.geom && ST_MakeEnvelope($1_lon_sw, $1_lat_sw, $2_lon_ne, $2_lat_ne, 4326)::geography
  AND vs.sport_slug = ANY($3_sport_slugs)
  AND v.is_published = true
  AND v.deleted_at IS NULL
LIMIT 500;
```

### Page détail venue
```sql
-- 1 requête pour le venue
SELECT v.*, c.name AS city_name, co.name_fr AS country_name
FROM venue v
LEFT JOIN city c ON c.id = v.city_id
LEFT JOIN country co ON co.code = v.country_code
WHERE v.slug = $1 AND v.is_published = true AND v.deleted_at IS NULL;

-- 1 requête pour les sports + amenities + booking_links (avec joins par batch)
```

### Liste paginée "padel à Paris"
```sql
SELECT v.id, v.slug, v.name, v.address, v.courts_count, v.enrichments->>'photo_url' AS photo
FROM venue v
JOIN venue_sport vs ON vs.venue_id = v.id
JOIN city c ON c.id = v.city_id
WHERE vs.sport_slug = 'padel'
  AND c.country_code = 'FR' AND c.slug = 'paris'
  AND v.is_published = true AND v.deleted_at IS NULL
ORDER BY v.courts_count DESC NULLS LAST, v.name
LIMIT 50 OFFSET $1;
```

## Migration de V1

Le script `scripts/import_v1.py` mappe :

| V1 SQLite | V2 Postgres |
|---|---|
| `clubs.*` (table principale) | `venue` (1 club V1 = 1 venue V2) |
| `clubs.sports` JSON | `venue_sport` (1 ligne par sport) |
| `clubs.features` JSON | `venue_amenity` (1 ligne par amenity true) |
| `clubs.family` | `venue.family_slug` |
| `clubs.club_id` | `venue.external_id` + `enrichments.v1_club_id` |
| `clubs.surfaces` JSON | `enrichments.surfaces` (à étendre vers venue_sport.surface plus tard) |
| `spots.*` (granularité fine) | **Non importés en V2** par défaut (perdus dans le clustering). Si besoin, ajouter table `installation` plus tard. |

## Évolutions prévues (Phase 3+)

- Table `installation` (sous-niveau de venue : court 1, court 2…) si besoin de réservation par court
- Table `event` (cours, stages, retraites à dates fixes — déjà esquissée en V1 via `retreat_events`)
- Table `review` (avis utilisateurs avec modération)
- Table `photo` (galerie multi-photos par venue, stockage Supabase Storage)
- Vue matérialisée `venue_with_aggregates` (calcul cached du nb sports + amenities count, refresh hourly)
