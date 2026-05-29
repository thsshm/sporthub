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

## Refresh data post-cutover (issue #109)

Une fois la V2 en prod, les données ne doivent plus se figer. V1 avait un
hook qui re-runnait 3 scrapers externes (Hyrox / Parapente / Plongée) après
chaque export DB + une tâche Wikidata hebdo (ADR-009 V1). En V2, on porte
la logique en **Vercel cron** : 4 routes API qui se déclenchent en HTTP
(pas besoin d'un worker dédié) et qui upsertent dans Supabase.

### Routes cron

| Route | Schedule (UTC) | Source | Action |
|---|---|---|---|
| `/api/cron/refresh-hyrox` | `0 3 * * 1` (lundi 3h) | `gyms.elbnetz.cloud` | Re-import des Hyrox Training Clubs |
| `/api/cron/refresh-paragliding` | `0 4 * * 1` (lundi 4h) | `paraglidingearth.com` | Re-import sites parapente / deltaplane par pays |
| `/api/cron/refresh-diving` | `0 5 * * 1` (lundi 5h) | OSM Overpass `dive_centre` | Re-import centres de plongée |
| `/api/cron/refresh-wikidata` | `0 6 * * 1` (lundi 6h) | Wikipedia REST API | Rafraîchit extract / photo / Q-ID pour venues avec `wikipedia_url` |

### Configuration Vercel (à faire une fois après merge)

1. **Set `CRON_SECRET`** dans Vercel → Settings → Environment Variables.
   ```bash
   openssl rand -base64 32
   ```
   Coller la valeur dans Production + Preview (sans `\n` final). Vercel
   envoie automatiquement `Authorization: Bearer <CRON_SECRET>` sur les
   crons définis dans `vercel.json` — sans cette variable, les crons sont
   refusés en 500 (safe-by-default).

2. **Vérifier que `SUPABASE_SERVICE_ROLE_KEY` est en Production** (utilisé
   par les routes pour bypasser RLS — déjà requis par d'autres routes).

3. **Plan Vercel** : sur Hobby, un seul cron est autorisé ; sur Pro,
   illimité. Si Gautier reste en Hobby, garder uniquement `refresh-hyrox`
   actif dans `vercel.json` et supprimer les 3 autres (les routes restent
   utilisables manuellement via `/api/admin/cron/run-all`).

4. **Premier run** : après merge + deploy, le prochain lundi 03:00 UTC
   déclenchera Hyrox. Pour tester avant ça : se logguer en admin, POST
   sur `/api/admin/cron/run-all`. Le résultat agrège les 4 statuts.

### Logging

Chaque route loggue une ligne JSON sur stdout à chaque run :

```json
{ "event": "cron.refresh-hyrox.completed", "upserted": 12734, "failed": 0, "duration_ms": 18432, "extra": { "fetched": 12745 } }
```

Visible dans **Vercel → Logs → Functions**. Pour suivre via Drain externe
(Logflare / Axiom), filtrer sur `event` qui commence par `cron.`.

Les erreurs vont à Sentry via `captureException()` (cf. `lib/monitoring.ts`)
avec `extra.route = "/api/cron/refresh-*"`.

### Idempotence

- Toutes les routes upsertent par `venue.slug` (= `slugify(name)-{source-id}`),
  jamais de DELETE. Un Hyrox / spot disparu de la source reste en DB tel
  quel — c'est plus safe que de purger sans piste (on évite de casser des
  permaliens publics).
- La route Wikipedia ne touche que `enrichments` JSONB, merge côté code
  (cf. PR #142). Aucune autre colonne n'est modifiée.
- Le compteur `SELECT count(*) FROM venue WHERE external_id LIKE 'hyrox/%'`
  est **strictement croissant ou stable** entre deux runs nominaux.

### Timeout / pagination

Les routes sont déclarées avec `maxDuration = 60` (limite Hobby).
La route paragliding (~210 pays) et wikidata (~quelques k venues) ont une
**rotation** par run : on prend les codes / venues les plus anciens et on
coupe quand on touche le budget temps. Sur plusieurs runs, on couvre tout
le set en quelques semaines.

Pour passer en run complet synchrone, monter `maxDuration` à 300 (Pro plan).
