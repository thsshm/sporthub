# SportHub V1 → V2 — Migration

> Document vivant. À mettre à jour à chaque PR qui touche une URL publique ou un schéma de données.

## Statut parité V1 → V2

Snapshot détaillé par zone (carte, popup, SEO, i18n, etc.) : voir [`docs/PARITY-V1-V2.md`](docs/PARITY-V1-V2.md). Source de vérité live : [issue #129](https://github.com/thsshm/sporthub/issues/129).

## Mapping URLs V1 → V2 (pour redirects 301 lors du cutover Phase 4)

| V1 URL | V2 URL | Notes |
|---|---|---|
| `/` | `/` | Identique |
| `/family-raquette.html` | `/sports/raquette` | Pages famille |
| `/family-ballon.html` | `/sports/ballon` | |
| `/family-fitness.html` | `/sports/fitness` | |
| `/family-combat.html` | `/sports/combat` | |
| `/family-yoga.html` | `/sports/yoga` | Slug interne reste yoga |
| `/family-baignade.html` | `/sports/baignade` | |
| `/family-boules.html` | `/sports/boules` | |
| `/family-nautique.html` | `/sports/nautique` | |
| `/family-glisse.html` | `/sports/glisse` | |
| `/family-snow.html` | `/sports/snow` | |
| `/family-hike.html` | `/sports/hike` | |
| `/family-retraites.html` | `/sports/retraites` | |
| `/family-plus.html` | `/sports/plus` | |
| `/villes.html` | `/villes` | |
| `/explore.html` | `/explore` | |
| `/padel-paris.html` | `/padel/fr/paris` | Pages programmatiques |
| `/padel-lyon.html` | `/padel/fr/lyon` | |
| `/padel-toulouse.html` | `/padel/fr/toulouse` | |
| `/tennis-paris.html` | `/tennis/fr/paris` | |
| `/tennis-lyon.html` | `/tennis/fr/lyon` | |
| `/tennis-toulouse.html` | `/tennis/fr/toulouse` | |
| `/petanque-paris.html` | `/petanque/fr/paris` | |
| `/petanque-lyon.html` | `/petanque/fr/lyon` | |
| `/petanque-marseille.html` | `/petanque/fr/marseille` | |
| `/yoga-paris.html` | `/yoga/fr/paris` | |
| `/yoga-lyon.html` | `/yoga/fr/lyon` | |
| `/boxe-paris.html` | `/boxe/fr/paris` | |
| `/salle-de-sport-paris.html` | `/gym/fr/paris` | Slug normalisé |
| `/academies-de-tennis.html` | `/sports/raquette/academies` | Hub éditorial |
| `/favoris.html` | `/favoris` | |
| `/seo-hotpicks.html` | _supprimé_ | URL interne, pas indexée |

### Format des redirects (à mettre dans `next.config.js`)

```js
async redirects() {
  return [
    { source: '/family-:slug.html', destination: '/sports/:slug', permanent: true },
    { source: '/padel-paris.html', destination: '/padel/fr/paris', permanent: true },
    { source: '/padel-lyon.html', destination: '/padel/fr/lyon', permanent: true },
    // ... etc, génériser ce qui peut l'être
  ]
}
```

## Mapping schéma DB V1 → V2

### Tables V1 (SQLite) → Tables V2 (Postgres)

| V1 | V2 | Mapping |
|---|---|---|
| `spots` | _non importé_ | granularité court individuel, perdu dans la clusterisation V1→V2 |
| `clubs` | `venue` | 1:1, voir détail ci-dessous |
| `spots.club_id` | `venue.external_id` | sert d'ancre pour tracing |
| `clubs.sports` JSON | `venue_sport` rows | 1 ligne par sport, `is_primary=true` pour le 1er |
| `clubs.features` JSON | `venue_amenity` rows + `venue.is_indoor/has_lighting/...` | features bool → amenity ; features struct → colonnes dédiées |
| `clubs.surfaces` JSON | `enrichments.surfaces` | Pour l'instant en JSONB, futur → `venue_sport.surface` |
| `enrichments` table | `venue.enrichments` JSONB | Tout dans une seule colonne |
| `retreat_events` | _à voir_ | Probablement futur table `event` |

### Colonnes V1 → V2 (mapping détaillé pour `clubs` → `venue`)

| V1 `clubs.*` | V2 `venue.*` |
|---|---|
| `club_id` | `external_id` |
| `family` | `family_slug` |
| `name` | `name` |
| `lat`, `lon` | `lat`, `lon` (+ `geom` auto via trigger PostGIS) |
| `city` | (lookup → `city_id` + `enrichments.v1_city_raw` si pas matché) |
| `country` | `country_code` (uppercase) |
| `postal_code` | `postal_code` |
| `address` | `address` |
| `courts_count` | `courts_count` |
| `website` | `website_url` |
| `phone` | `phone` |
| `operator` | `enrichments.operator` |
| `brand` | `enrichments.brand` |
| `sources` JSON | `source` (1er élément) + `enrichments.sources_all` |
| `rule` (ex `G_geo_50m`) | `enrichments.cluster_rule` |
| `created_at` | `enrichments.v1_created_at` |

## Checklist parité avant cutover

À cocher avant de basculer le domaine sporthubmap.com vers V2.

### SEO
- [ ] Sitemap V2 contient au moins toutes les URLs V1 (+ les nouvelles `/venue/[slug]`)
- [ ] Toutes les pages V1 ont une redirect 301 vers V2 documentée
- [ ] Google Search Console v2 : aucune erreur d'indexation majeure
- [ ] Lighthouse SEO > 90 sur 5 pages random
- [ ] Schema.org SportsActivityLocation validé sur `/venue/[slug]` (rich result test)
- [ ] hreflang FR/EN/ZH présent et valide

### Fonctionnel
- [ ] Carte V2 affiche autant de spots que carte V1 sur même bbox (à ±5%)
- [ ] Filtres sport fonctionnent (test : padel à Paris donne ≥ X résultats)
- [ ] Popup spot a au moins les boutons : Itinéraire (Google+Apple+Waze), Partager (WhatsApp+Copy), Réservation si dispo
- [ ] Pages programmatiques (sport × ville) bien rendues
- [ ] Favoris localStorage migrent vers DB pour les users authentifiés

### Performance
- [ ] LCP < 2.5s sur `/`, `/map`, `/venue/[slug]` (mobile 4G)
- [ ] Bundle JS initial < 200 KB (gzip)
- [ ] First contentful paint sur carte < 1s

### Monitoring
- [ ] Sentry capture les erreurs (tester avec un throw artificiel)
- [ ] PostHog enregistre les pageviews + 5 events clés
- [ ] Plausible V1 archivé (data conservée, snapshot avant cutover)
