# SportHub V2 — Architecture Decision Records

> Une ADR par décision structurante. Chaque ADR est immutable (ne pas modifier après merge).
> Si une décision change, créer une nouvelle ADR qui supersede l'ancienne.

## ADR-001 — Stack Next.js 14 (App Router) + TypeScript strict

**Contexte** : V1 était en HTML/JS vanilla. V2 a besoin de SSR (SEO `/venue/[slug]`), d'auth user, d'un admin propre, d'un workflow PR + preview.

**Décision** : Next.js 14 App Router + TypeScript strict.

**Alternatives évaluées** :
- Remix : excellent pour SSR mais écosystème + petit, intégration Vercel un peu moins fluide
- Astro : génial SSG mais routes dynamiques moins pratiques pour 60k+ venues
- SvelteKit : framework superbe mais shadcn et la communauté React donnent + de leverage Claude Code

**Conséquences** :
- Compatibilité totale avec Vercel preview deployments
- shadcn/ui + Tailwind = velocity max sur l'UI
- Server Components réduisent le bundle client
- Coût : un peu de courbe d'apprentissage App Router vs Pages Router

## ADR-002 — Supabase (Postgres managed) plutôt que SQLite/Prisma/RDS

**Contexte** : V1 = SQLite local + JS files exportés. Ne scale pas pour user-generated content, claims, admin.

**Décision** : Supabase Cloud (region Paris).

**Alternatives évaluées** :
- PlanetScale (MySQL) : pas de support PostGIS → no go pour les requêtes spatiales
- Neon (Postgres serverless) : excellent, mais Supabase ajoute auth + storage + RLS out-of-the-box
- AWS RDS : trop de plumbing pour notre stade
- Self-hosted Postgres : viable mais 0 DevOps wanted

**Conséquences** :
- DB + auth + file storage + edge functions dans un seul produit
- Row Level Security (RLS) sécurité par défaut
- Studio web pour gérer la DB sans coder
- Vendor lock-in modéré (mais Postgres standard donc export possible à tout moment)
- Coût : gratuit jusqu'à 500 MB DB, puis $25/mo Pro plan

## ADR-003 — MapLibre GL plutôt que Leaflet (V1) ou Mapbox

**Contexte** : V1 utilise Leaflet 1.9 + leaflet.markercluster. MapLibre est le fork ouvert de Mapbox GL JS.

**Décision** : MapLibre GL + react-map-gl wrapper.

**Alternatives évaluées** :
- Continuer Leaflet : marche mais styles vector tiles moins beaux, performance limitée > 50k markers
- Mapbox GL JS : excellent mais payant au-delà du free tier (50k loads/mo)
- Google Maps JS : qualité top mais cher et closed-source

**Conséquences** :
- WebGL rendering (smooth pan/zoom même avec 100k+ markers via clustering)
- Vector tiles open (MapTiler, Stadia, OSM tile servers)
- API quasi-identique à Mapbox GL pour migrer facilement
- Coût : tile server (MapTiler free tier 100k req/mo OK pour début)

## ADR-004 — Tables Postgres au singulier (`venue`) plutôt que pluriel (`venues`)

**Contexte** : Convention de nommage à fixer pour éviter incohérence ultérieure.

**Décision** : Singulier snake_case partout (`venue`, `venue_sport`, `claim_request`).

**Argumentation** : Une ligne = une instance ; `SELECT * FROM venue` lit comme du français ; conventions SQL classiques (Date, Codd) sont singulier.

**Conséquences** : Cohérence avec Supabase generated TypeScript types (chaque table singulier = un type singulier).

## ADR-005 — PostGIS dès la migration 0003, pas après

**Contexte** : Requêtes spatiales (carte bbox, "venues dans 5 km") ~100× plus rapides avec index GIST que B-tree sur lat/lon.

**Décision** : Activer PostGIS dans la migration 0003 (juste après l'import V1).

**Alternatives évaluées** :
- B-tree (lat, lon) : marche jusqu'à ~10k venues, dégrade au-delà
- ElasticSearch / Algolia : overkill et $$$

**Conséquences** :
- Toutes les requêtes carte tirent partie de l'index spatial
- Coût : extension Postgres activée (gratuit chez Supabase)
- Trigger auto-update du champ `geom` quand `lat`/`lon` changent

## ADR-006 — Slugs URL au format `/[sport]/[country]/[city]`

**Contexte** : V1 avait `padel-paris.html`, `tennis-lyon.html`. Mauvaise extensibilité (pas de granularité par pays).

**Décision** : URL Next.js `[sport]/[country]/[city]` avec country en ISO lowercase.
Exemple : `/padel/fr/paris`, `/yoga/es/barcelona`, `/surf/pt/lisboa`.

**Alternatives évaluées** :
- `/sports/[sport]/[city]` : pas extensible international
- `/[country]/[city]/[sport]` : moins SEO-friendly (la requête typique commence par le sport)
- `/[city]/[sport]` (skip country) : ambigu pour villes homonymes

**Conséquences** : SEO optimisé pour requêtes "padel paris" (mot du début dans l'URL = poids fort).

## ADR-007 — Soft delete via `deleted_at` plutôt que DELETE physique

**Contexte** : Venues peuvent être créées par scraper, modifiées par claim, parfois supprimées par admin. On veut audit + récupération possible.

**Décision** : `deleted_at TIMESTAMPTZ` sur les tables avec data importante (`venue`, `claim_request`). DELETE physique seulement sur tables de liaison (`venue_sport`, `venue_amenity`).

**Conséquences** :
- Toutes les requêtes publiques filtrent `WHERE deleted_at IS NULL`
- Possibilité de "restore" en admin
- Soft delete cascade pas auto (à gérer dans les fonctions admin)

## ADR-008 — Pas de tracking PII par défaut (RGPD-friendly)

**Contexte** : PostHog peut tracker IP, user-agent, identité authentifiée. Tendance produit-actuelle = tout tracker. Notre proposition produit = "sans tracking intrusif".

**Décision** :
- PostHog configuré avec `disable_session_recording: true` (sauf opt-in user)
- Pas de tracking pré-consentement (cookie banner only si on tracke vraiment)
- Sentry sans capture user identity

**Conséquences** : Différenciation par rapport à la concurrence ("on respecte ta vie privée"). Coût analytics légèrement réduit (moins de data captée mais l'essentiel suffit).

## ADR-009 — V1 maintenue en parallèle pendant toute la migration

**Contexte** : Risque rewrite : rester bloqué en V2 incomplète pendant des mois, V1 désuète.

**Décision** :
- V1 reste live à `sporthubmap.com` (Netlify) pendant Phase 1-3
- V2 développée sur `app.sporthubmap.com` (Vercel)
- Cutover (Phase 4) inverse les rôles : V1 archivée sur `legacy.sporthubmap.com`, V2 sur `sporthubmap.com`

**Conséquences** :
- Pas de pression "il faut shipper avant de perdre l'audience"
- 1-2 mois de double maintenance (juste bug fixes V1, pas de features)
- Cutover propre avec validation A/B des Core Web Vitals

## Template pour nouvelles ADRs

```markdown
## ADR-NNN — [Titre court de la décision]

**Contexte** : Pourquoi cette décision se pose maintenant.

**Décision** : Ce qu'on a choisi.

**Alternatives évaluées** : Listes des options + pourquoi rejetées.

**Conséquences** : Bénéfices et coûts de cette décision.

**Date** : YYYY-MM-DD. **Auteur** : Gautier.
```
