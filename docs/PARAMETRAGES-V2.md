# Paramétrages V2 — référence du tuning (filtres + UX)

> Inventaire des « petits paramétrages » réglés dans SportHub V2 : filtres, carte,
> cache, pagination, i18n/SEO, crons. Objectif : ne rien perdre du tuning et savoir
> où chaque réglage vit. Audit du 2026-06-07 (code sweep sur `main`).
>
> **Sources de vérité** : `lib/families.ts`, `lib/sports.ts`, `lib/retreats.ts`,
> `lib/facets.ts`, `lib/bbox.ts`, `app/[locale]/map/MapClient.tsx`,
> `app/api/venues/*`, `vercel.json`, `i18n/routing.ts`, `lib/seo/*`.
> Ce doc est dérivé du code — en cas de doute, le code prime.

## 1. Filtres

### Familles (14) — `lib/families.ts`
`raquette` 🎾 · `ballon` ⚽ · `fitness` 🏋️ · `combat` 🥊 · `yoga` 🧘 (affiché « Bien-être ») ·
`baignade` 🏊 · `boules` 🟢 · `nautique` ⛵ · `glisse` 🏄 · `snow` ⛷️ ·
`hike` 🥾 (affiché « Plein air & endurance ») · `escalade` 🧗 (ajoutée #312) ·
`retraites` 🌿 (overlay éditorial, pas une vraie famille) · `plus` ⛳

Chaque famille : `slug`, `name_fr`, `name_en`, `emoji`, `color` (hex), `position`, `sports[]`.
Accès : `FAMILIES`, `FAMILIES_BY_SLUG`, `getFamilyColor()`, `getFamilyEmoji()`.

⚠️ Les slugs internes `yoga` / `hike` diffèrent des noms affichés (« Bien-être » /
« Plein air & endurance ») — héritage V1, ne pas renommer (compat données).

### Sports (~54) — `lib/sports.ts`
Répartition par famille : raquette 5 · ballon 5 · fitness 5 · yoga 5 · combat 5 ·
boules 2 · baignade 2 · glisse 5 · nautique 3 · snow 3 · hike 6 · escalade 1 · plus 4 · retraites 3.
Chaque sport : `slug`, `name_fr/en`, `family_slug`, `emoji`, `color`, `position`.
Accès : `SPORTS`, `SPORTS_BY_SLUG`, `SPORTS_BY_FAMILY`.
`MAIN_SPORT_SLUGS` (10, pages statiques) : tennis, padel, football, basketball, gym,
yoga, surf, skiing, running, petanque.

### Critères & surfaces — `app/[locale]/map/SportFilters.tsx`
- **Critères (5)** : `lit` 🌙 · `indoor` 🏠 · `wheelchair` ♿ · `free` 🆓 · `paid` 💰
- **Surfaces (6)** : `clay` · `concrete` · `synthetic` · `grass` · `parquet` · `sand`
- Ensembles **fermés**, revalidés côté API (`KNOWN_SURFACES` + critères canoniques dans
  `app/api/venues/route.ts` / `facets/route.ts`) — toute autre valeur est ignorée.
- Surface stockée sur `venue_sport.surface` (pas sur `venue`).

### Retraites — `app/[locale]/famille/retraites/page.tsx` + `lib/retreats.ts`
- **Types (5)** : `yoga_retreat` · `surf_camp` · `wellness_retreat` · `fitness_bootcamp` ·
  `tennis_camp` — param URL `?type=`. Colonne `venue.retreat_type` (migr 0022).
- **Saisons (4)** : `winter` (déc-fév) · `spring` (mar-mai) · `summer` (juin-août) ·
  `autumn` (sep-nov) — param `?r_season=`, logique `retreatSeason()`.
- **Hébergement** : `?r_lodging=1`.
- Logique transverse (migr 0024) :
  `family_slug = ANY(fams) OR ('retraites' = ANY(fams) AND retreat_type IS NOT NULL)`.

### Facettes (compteurs live) — RPC `venues_facets_in_bbox` (0019/0024) + `/api/venues/facets`
3 dimensions : `family` / `criteria` / `surface`. **Chaque groupe ignore sa propre
sélection** (évite les culs-de-sac, sémantique faceted-search). Retour `(facet_type,
facet_key, n)` pivoté côté client (`lib/facets.ts`).

### Recherche — `components/SearchBar.tsx`
debounce **400 ms** · min **3 caractères** · max **5 résultats** · source Nominatim (OSM),
`accept-language=fr`.

## 2. Carte & clustering (UX)

| Réglage | Valeur | Fichier |
|---|---|---|
| Seuil POI ↔ agrégats | **zoom 10** (`ZOOM_POI_THRESHOLD`) | MapClient.tsx + api/venues |
| Clustering radius | **40 px** (était 60, #320) | MapClient.tsx:583 |
| Clustering maxZoom | **15** (était 16) | MapClient.tsx:585 |
| Mode club (pins groupés) | zoom **10–15** | MapClient.tsx:43-44 |
| Familles exclues du mode club | ballon, boules, nautique, plus, snow, retraites | MapClient.tsx:30-37 |
| Debounce pan/zoom | **200 ms** (venues +50, clubs +350, facets +50) | MapClient.tsx:87 |
| Fade agrégats ↔ POI | **200 ms** | MapClient.tsx:89 |
| Viewport initial | centre **46.5 / 2.5** (France), zoom **5** | map/page.tsx |
| SSR pré-fetch | bbox Europe **-10,35,20,55**, limite **500** venues | map/page.tsx:13-14 |
| Modes de vue | `map` / `list` / `split` (split ≥ **1100 px**) | map-storage + MapWithSearch.tsx |
| Clamp anti-bug PostGIS | lon **±179.9**, lat **±89.9** | lib/bbox.ts |
| Vue « monde » | si span ≥ **350°** lon ET **170°** lat | lib/bbox.ts |
| Arrondi bbox (cache CDN) | **2 décimales** (~1,1 km) ; `zoomBucket = floor(zoom)` | api/venues:32 |
| Limites RPC | venues **2000** (max **5000**) · clubs **5000** · courts/club **200** | api/venues, clubs |
| Antiméridien | bbox `west > east` → 2 requêtes fusionnées côté client | lib/bbox.ts |

**Agrégats serveur (zoom < 10)** — vues matérialisées web-mercator `mv_venue_country_agg`
/ `mv_venue_grid_agg` (migr 0039/0040, **supersèdent** la grille en degrés 0014) :
- zoom < 6 → agrégat par **pays** ;
- grid_size_m : zoom ≤6 **500 km** · z7 **200 km** · z8 **100 km** · z9 **50 km** ;
- refresh : RPC `refresh_venue_aggregates()` via pg_cron (#387/#394).

**Persistance (localStorage)** : `sporthub-map-viewport`, `sporthub-map-view-mode`,
`sporthub-map-auto-update`, `sporthub-favorites`, `sporthub_picker_seen`,
`sporthub_geo_prompted`.

**Empty states carte** (`lib/empty-state.ts`) : zoom < **4** (trop bas) · zoom > **14** + 0
résultat (trop haut) · filtres actifs + 0 · générique.

## 3. Cache / ISR

| Page / route | revalidate / Cache-Control |
|---|---|
| Home `/` | ISR **300 s** |
| `/map` | ISR **60 s** (fixes post-deploy rapides) |
| `/sports/[sport]`, `/disciplines/[sport]`, `/villes`, `/venue/[slug]` | ISR **3600 s** |
| `/[sport]/[country]/[city]`, `/club/[slug]` | ISR **86400 s** |
| `/favoris`, `/admin/*` | `force-dynamic` |
| API venues — agrégats | `s-maxage=3600, stale-while-revalidate=86400` |
| API venues — POI / facets / clubs | `s-maxage=300, stale-while-revalidate=3600` |
| Sitemap | `s-maxage=86400` |

## 4. Pagination & classements

- PAGE_SIZE : **24** (sports, sport×ville, retraites) · **50** (disciplines, admin) ·
  **48** villes (`MAX_CITIES`).
- **Disciplines** classables : tennis, padel, table_tennis, badminton, squash —
  top **50** clubs par `courts_count` (MV `mv_top_clubs_by_sport`), `noindex` si vide.
- Home : familles affichées si **≥ 10 venues** ; **4** sports/chip ; **6** villes featured ;
  **8** top spots (filtrés sur `google_rating` parmi 40).

## 5. i18n / SEO

- Locales : **fr** (défaut), **en**, **zh** ; préfixe URL `as-needed` ;
  clé langue `sporthub-lang` ; cycle nav FR→EN→ZH.
- hreflang fr/en/zh + `x-default` → fr. `SITE_URL = https://sporthubmap.com`, OG 1200×630.
- Sitemap : **45 000** URLs/shard, **9 shards** (8 venues + 1 méta/statiques/programmatiques).
- JSON-LD : BreadcrumbList, ItemList, FAQPage, SportsActivityLocation, Place, WebSite.
- robots.txt : crawlers IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot…)
  **explicitement autorisés**. Disallow `/admin/`, `/api/`.

## 6. Crons (`vercel.json`) — tous le lundi, UTC

| Job | Heure | Rafraîchit |
|---|---|---|
| refresh-hyrox | 03:00 | clubs HYROX |
| refresh-paragliding | 04:00 | sites parapente (~210 pays ISO) |
| refresh-diving | 05:00 | centres de plongée (OSM Overpass) |
| refresh-wikidata | 06:00 | descriptions + photos (300 venues/run, desc 400 car.) |
| refresh-top-cities | 07:00 | MV `mv_top_cities_by_venue_count` |
| refresh-top-clubs | 08:30 | MV `mv_top_clubs_by_sport` |
| refresh-aggregates | 09:00 | MV agrégats carte (#387 ; via pg_cron #394) |

`maxDuration = 60 s` ; budget fetch externe ~45 s ; upsert par lots de 200.

## 7. Home A/B — `components/home/HomeHero.tsx`

Flag PostHog `home_layout` : `brochure` (contrôle) vs `map-first` (hero compact + CTA géoloc).
Métrique `home_map_cta_click`. Défaut sûr = brochure (aucune régression si flag absent).

## 8. Divers

- Next.js : PWA Serwist (prod), redirections 301 V1→V2 (`next.config.js`), theme-color `#2d7a3e`.
- Édition venue (admin) : description **2000** car., nom/adresse **200**, URLs **500**.
- Admin venues : PAGE_SIZE **50**, tri `id DESC` (updated_at trop lent sur ~348k lignes).
