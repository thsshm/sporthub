# SportHub V2 — Issues GitHub (backlog initial)

> Ce fichier contient les 20 premières issues à créer sur le repo GitHub de SportHub V2.
> Elles couvrent les phases 1, 2 et 3 telles que définies dans `ROADMAP.md`.
>
> **Usage** : voir la section "Comment créer ces issues en masse sur GitHub" en bas du fichier.
>
> Conventions :
> - Labels disponibles : `phase-1`, `phase-2`, `phase-3`, `area:backend`, `area:frontend`,
>   `area:data`, `area:infra`, `area:seo`, `area:auth`, `area:admin`,
>   `priority:p0`, `priority:p1`, `priority:p2`, `type:chore`, `type:feat`, `type:perf`
> - Estimates : `2h`, `4h`, `1d`, `2d`
> - Toutes les PRs doivent fermer l'issue via `Closes #N` dans le corps de la PR.

---

## Issue #1 — Scaffold Next.js 14 + TS + Tailwind + shadcn + MapLibre + Supabase client

**Labels** : `phase-1` `area:infra` `type:chore` `priority:p0`
**Estimate** : 4h
**Phase** : 1 (Fondations)
**Bloquée par** : —

### Contexte
Issue de tracking pour le commit initial du scaffold V2. Le repo est créé mais vide. On a besoin d'un point de départ opérationnel avec toute la stack configurée : Next.js 14 App Router, TypeScript strict, Tailwind CSS, shadcn/ui, MapLibre GL via react-map-gl, et le client Supabase. Cette issue se ferme au premier commit qui fait tourner `pnpm dev` sans erreur.

### Tâches
- [ ] Initialiser le projet avec `create-next-app@latest` (App Router, TypeScript, Tailwind, ESLint)
- [ ] Configurer `tsconfig.json` en mode strict (`"strict": true`, pas de `any` implicite)
- [ ] Installer et initialiser shadcn/ui (`npx shadcn-ui@latest init`)
- [ ] Installer `maplibre-gl` et `react-map-gl` (wrapper React officiel)
- [ ] Installer et configurer le client Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- [ ] Créer `lib/supabase/server.ts` et `lib/supabase/client.ts` (deux clients distincts, cf. CLAUDE.md)
- [ ] Créer `lib/env.ts` qui expose les variables d'env typées (jamais de `process.env.X` direct en dehors)
- [ ] Créer `.env.example` avec toutes les variables requises documentées
- [ ] Configurer `next.config.js` (images domains Supabase Storage, transpilePackages si besoin)
- [ ] Vérifier que `pnpm build` passe sans erreur TypeScript
- [ ] Mettre à jour `ROADMAP.md` section semaine 1

### Acceptance criteria
- [ ] `pnpm dev` lance le serveur sans erreur sur `http://localhost:3000`
- [ ] `pnpm build` compile sans erreur TypeScript ni ESLint bloquant
- [ ] `lib/env.ts` expose `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` correctement typés
- [ ] Un import de `createServerClient` depuis `lib/supabase/server.ts` ne provoque pas d'erreur
- [ ] Le fichier `.env.example` est commité, `.env.local` est dans `.gitignore`
- [ ] Pas de `any` TypeScript dans les fichiers créés

### Notes techniques
- Utiliser `pnpm` (pas `npm` ni `yarn`) — cohérence avec le workflow défini dans CLAUDE.md.
- `react-map-gl` v7+ est compatible MapLibre (passer `mapLib={maplibregl}` en prop).
- Le client server-side doit utiliser `cookies()` de `next/headers` — disponible uniquement en Server Components et Route Handlers.
- shadcn/ui utilise le preset `slate` par défaut — adapter les couleurs aux variables `--f-*` définies dans CLAUDE.md lors d'une issue ultérieure dédiée au design system.
- Référence : [Supabase Next.js App Router guide](https://supabase.com/docs/guides/auth/server-side/nextjs)

---

## Issue #2 — Configurer Supabase project + env vars Vercel + Sentry + PostHog branchés

**Labels** : `phase-1` `area:infra` `type:chore` `priority:p0`
**Estimate** : 4h
**Phase** : 1 (Fondations)
**Bloquée par** : #1

### Contexte
Le scaffold est en place mais sans Supabase réel, sans monitoring et sans preview URL Vercel. Cette issue connecte tous les services externes nécessaires pour travailler correctement dès le début. Le monitoring d'abord, pas à la fin — un bug de migration DB silencieux est le pire scénario.

### Tâches
- [ ] Créer le projet Supabase dans la région `eu-west-3` (Paris) via le Dashboard ou la CLI
- [ ] Récupérer `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` et les ajouter dans Vercel (env var production + preview)
- [ ] Brancher le repo GitHub sur Vercel (auto-deploy sur `main`, preview URL par PR)
- [ ] Installer et configurer Sentry (`@sentry/nextjs`) : `sentry.client.config.ts`, `sentry.server.config.ts`, `instrumentation.ts`
- [ ] Ajouter `SENTRY_DSN` dans `.env.example` et dans Vercel
- [ ] Installer et configurer PostHog (`posthog-js`, `posthog-node`) via un `PostHogProvider` côté client
- [ ] Créer la route `/api/monitoring/sentry-test` qui throw une erreur contrôlée pour valider le pipeline
- [ ] Vérifier que l'erreur test apparaît dans le dashboard Sentry
- [ ] Mettre à jour `.env.example` avec toutes les nouvelles variables

### Acceptance criteria
- [ ] `NEXT_PUBLIC_SUPABASE_URL` pointe vers un projet Supabase réel en région Paris
- [ ] Vercel déploie automatiquement à chaque push sur `main`
- [ ] Chaque PR reçoit une preview URL Vercel fonctionnelle
- [ ] Un appel à `/api/monitoring/sentry-test` crée une issue visible dans Sentry dans les 60 secondes
- [ ] PostHog reçoit au moins un event `$pageview` lors d'une visite sur la preview URL
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` documentés dans `.env.example`
- [ ] Build Vercel preview OK

### Notes techniques
- Ne jamais commiter `SUPABASE_SERVICE_ROLE_KEY` — cette clé bypasse la RLS, réservée aux scripts et routes admin côté serveur uniquement.
- Pour Sentry avec Next.js 14 App Router, le `instrumentation.ts` à la racine est la méthode recommandée (pas le vieux `_app.tsx`).
- PostHog self-hosted ou cloud EU (`https://eu.posthog.com`) pour conformité RGPD — à préciser avec Gautier.
- Packages : `@sentry/nextjs`, `posthog-js`, `posthog-node`
- Référence Sentry App Router : [https://docs.sentry.io/platforms/javascript/guides/nextjs/](https://docs.sentry.io/platforms/javascript/guides/nextjs/)

---

## Issue #3 — Appliquer migration 0001 (tables initiales + seed sports/countries/amenities)

**Labels** : `phase-1` `area:backend` `area:data` `type:chore` `priority:p0`
**Estimate** : 2h
**Phase** : 1 (Fondations)
**Bloquée par** : #2

### Contexte
Le projet Supabase est créé mais vide. La migration `0001_initial_schema.sql` définit toutes les tables référentielles (`country`, `sport`, `city`, `amenity`), la table centrale `venue`, les tables de liaison (`venue_sport`, `venue_amenity`, `booking_link`, `claim_request`), les indexes B-tree, les triggers `updated_at`, et les politiques RLS. Elle inclut également un seed avec 5 pays, 55 sports et 18 amenities.

### Tâches
- [ ] Installer la Supabase CLI (`brew install supabase/tap/supabase` ou via `pnpm dlx supabase`)
- [ ] Lier le projet local au projet Supabase distant (`supabase link --project-ref <ref>`)
- [ ] Appliquer la migration via `supabase db push` (ou coller le SQL dans le Dashboard si CLI non configurée)
- [ ] Vérifier que toutes les tables existent dans le Dashboard Supabase → Table Editor
- [ ] Vérifier que le seed s'est bien exécuté (`SELECT count(*) FROM sport` → ≥ 55)
- [ ] Vérifier que RLS est activée sur `venue`, `claim_request`, `venue_sport`, `venue_amenity`, `booking_link`
- [ ] Ajouter `supabase/migrations/0001_initial_schema.sql` dans le contrôle de version si ce n'est pas déjà fait

### Acceptance criteria
- [ ] `SELECT count(*) FROM sport` retourne ≥ 55 lignes
- [ ] `SELECT count(*) FROM country` retourne 5 lignes (FR, ES, IT, US, GB)
- [ ] `SELECT count(*) FROM amenity` retourne 18 lignes
- [ ] `SELECT count(*) FROM venue` retourne 0 (import pas encore fait)
- [ ] RLS activée : un appel avec la clé `anon` ne peut pas lire les venues `is_published = false`
- [ ] Le trigger `trg_venue_updated_at` existe bien (vérifiable dans Dashboard → Database → Triggers)
- [ ] Build Vercel preview OK après ces changements

### Notes techniques
- Migration concernée : `supabase/migrations/0001_initial_schema.sql`
- Ne pas modifier ce fichier après application — toute modification doit passer par `0002_*.sql` ou supérieur.
- Si `supabase db push` échoue sur la RLS policy `auth.users`, vérifier que l'extension `uuid-ossp` est activée (elle l'est dans le fichier SQL).
- Le champ `claimed_by UUID REFERENCES auth.users(id)` nécessite que l'extension Auth soit activée — c'est le cas par défaut dans Supabase.
- Référence : [Supabase CLI migrations](https://supabase.com/docs/guides/cli/managing-environments)

---

## Issue #4 — Appliquer migration 0003 (PostGIS + index spatial + trigger geom)

**Labels** : `phase-1` `area:backend` `type:chore` `priority:p0`
**Estimate** : 2h
**Phase** : 1 (Fondations)
**Bloquée par** : #3

### Contexte
Les requêtes spatiales ("venues dans cette bbox") sont au cœur de la carte. Sans index PostGIS, chaque requête scanne toute la table `venue` — acceptable sur 1 000 rows, catastrophique sur 60 000+. La migration 0003 active l'extension `postgis`, ajoute une colonne `geom geography(POINT, 4326)` sur `venue`, crée un trigger qui la maintient synchronisée avec `lat`/`lon`, et pose un index GIST.

### Tâches
- [ ] Créer `supabase/migrations/0003_postgis.sql` (numéroter après 0002 même si 0002 n'existe pas encore)
- [ ] Activer l'extension PostGIS dans la migration : `CREATE EXTENSION IF NOT EXISTS postgis`
- [ ] Ajouter la colonne `geom geography(POINT, 4326)` à la table `venue`
- [ ] Créer le trigger `trg_venue_geom` qui exécute `ST_SetSRID(ST_Point(lon, lat), 4326)` à chaque INSERT/UPDATE
- [ ] Créer l'index GIST : `CREATE INDEX idx_venue_geom ON venue USING GIST(geom)`
- [ ] Remplir `geom` pour les lignes existantes (`UPDATE venue SET geom = ST_SetSRID(ST_Point(lon, lat), 4326)`)
- [ ] Appliquer via `supabase db push`
- [ ] Vérifier avec une requête `ST_DWithin` test

### Acceptance criteria
- [ ] `SELECT PostGIS_Version()` retourne une version ≥ 3.0
- [ ] `\d venue` dans psql montre la colonne `geom geography`
- [ ] `SELECT count(*) FROM venue WHERE geom IS NOT NULL` retourne 0 (aucune venue encore importée, mais le trigger est en place)
- [ ] `EXPLAIN SELECT * FROM venue WHERE geom && ST_MakeEnvelope(2.3, 48.8, 2.4, 48.9, 4326)::geography` utilise l'index GIST (pas de `Seq Scan`)
- [ ] L'index `idx_venue_geom` apparaît dans le Dashboard Supabase → Database → Indexes
- [ ] Build Vercel preview OK

### Notes techniques
- Migration concernée : `supabase/migrations/0003_postgis.sql` (à créer)
- PostGIS est disponible sur Supabase sans configuration supplémentaire — activer via `CREATE EXTENSION IF NOT EXISTS postgis` suffit.
- Attention à l'ordre des arguments dans `ST_Point(lon, lat)` (longitude EN PREMIER, latitude en second) — erreur classique.
- Le type `geography` (pas `geometry`) gère la courbure terrestre — correct pour des distances en mètres réels.
- La requête bbox dans `DATA_MODEL.md` utilise `ST_MakeEnvelope($1_lon_sw, $1_lat_sw, $2_lon_ne, $2_lat_ne, 4326)` — s'assurer que le trigger génère bien un type `geography` compatible.

---

## Issue #5 — Script `import_v1.py` : peupler 1 000 venues en test, vérifier intégrité

**Labels** : `phase-1` `area:data` `type:chore` `priority:p0`
**Estimate** : 1d
**Phase** : 1 (Fondations)
**Bloquée par** : #4

### Contexte
Avant d'importer les 60 000+ venues V1, il faut valider le script d'import sur un échantillon de 1 000 venues. Le script doit lire `data-pipeline/data/sportpin.sqlite` (V1, en lecture seule), mapper les colonnes selon `MIGRATION.md` et `DATA_MODEL.md`, insérer dans les tables Supabase V2 (`venue`, `venue_sport`, `venue_amenity`), et détecter les doublons et les données manquantes. Ce test de 1 000 venues est la gate avant l'import complet (#6).

### Tâches
- [ ] Créer `scripts/import_v1.py` avec argparse : `--mode=clubs-only`, `--limit=N`, `--dry-run`, `--supabase-url`, `--supabase-key`
- [ ] Implémenter la lecture SQLite depuis `data-pipeline/data/sportpin.sqlite` (table `clubs`)
- [ ] Mapper les colonnes V1 → V2 selon le tableau dans `MIGRATION.md` (section "Colonnes V1 → V2")
- [ ] Générer le `slug` venue : `slugify(name)` + suffixe `city` + déduplication si collision
- [ ] Créer les villes manquantes dans `city` à la volée (si ≥ 3 spots dans la ville)
- [ ] Insérer les sports via `venue_sport` (un INSERT par sport JSON dans `clubs.sports`)
- [ ] Insérer les amenities via `venue_amenity` (depuis `clubs.features` JSON)
- [ ] Logger les erreurs et skip les venues avec `lat=None` ou `lon=None`
- [ ] Lancer `--limit=1000 --dry-run` et corriger les erreurs de mapping
- [ ] Lancer `--limit=1000` (sans dry-run) sur le projet Supabase de dev

### Acceptance criteria
- [ ] `python scripts/import_v1.py --limit=1000 --dry-run` se termine sans exception Python
- [ ] `python scripts/import_v1.py --limit=1000` insère exactement 1 000 venues (ou N ≤ 1 000 si certaines sont invalides, loggées)
- [ ] `SELECT count(*) FROM venue` ≥ 990 (tolérance 1% pour venues sans lat/lon)
- [ ] `SELECT count(*) FROM venue_sport` ≥ 1 500 (en moyenne 1,5 sport par venue)
- [ ] `SELECT v.slug, count(*) FROM venue v GROUP BY v.slug HAVING count(*) > 1` retourne 0 ligne (pas de slug dupliqué)
- [ ] Chaque venue importé a `geom IS NOT NULL` (trigger PostGIS actif)
- [ ] `enrichments->>'v1_club_id'` est rempli pour 100% des venues importés (traçabilité)
- [ ] Le script est idempotent : relancer sur les mêmes 1 000 ne crée pas de doublons (`ON CONFLICT DO NOTHING` ou upsert sur `external_id`)

### Notes techniques
- Lire la table `clubs` du SQLite avec `sqlite3` standard Python (pas de dépendance externe).
- Pour l'upsert Supabase : utiliser `supabase-py` (`pip install supabase`) avec `.upsert()` sur le champ `external_id`.
- Le champ `clubs.sources` est un JSON array — prendre `sources[0]` comme `venue.source`, garder tout dans `enrichments.sources_all`.
- Référence mapping complet : `MIGRATION.md` section "Mapping schéma DB V1 → V2".
- Villes : utiliser le champ `clubs.city` brut pour le nom, et `clubs.country` pour le code pays. Si la ville n'est pas dans la table `city` et compte ≥ 3 spots dans le batch, la créer.
- Packages Python : `supabase`, `python-slugify` (pour la génération de slug propre), `sqlite3` (stdlib).

---

## Issue #6 — Import full V1 → Supabase (60 000+ venues + venue_sport + venue_amenity)

**Labels** : `phase-1` `area:data` `type:chore` `priority:p0`
**Estimate** : 4h
**Phase** : 1 (Fondations)
**Bloquée par** : #5

### Contexte
Le script d'import est validé sur 1 000 venues (#5). On passe maintenant à l'import complet de toutes les familles V1 : ~87k raquette, ~63k ballon, ~12k fitness, etc. (total ~220k spots V1 → ~60k clubs après déduplication par lat/lon). C'est le milestone qui rend la carte V2 fonctionnelle avec de vraies données.

### Tâches
- [ ] Lancer `python scripts/import_v1.py --mode=clubs-only` (sans `--limit`) sur le projet Supabase production
- [ ] Monitorer les logs d'import (erreurs, skips, doublons détectés)
- [ ] Vérifier le count par famille après import (comparer avec les counts V1 dans `CLAUDE.md`)
- [ ] Vérifier que `SELECT count(*) FROM venue` ≥ 60 000
- [ ] Vérifier un échantillon de venues manuellement (Roland-Garros, stade connu, etc.)
- [ ] Vérifier que l'index spatial est toujours performant post-import (`EXPLAIN` sur une requête bbox)
- [ ] Mettre à jour `ROADMAP.md` : marquer le milestone Phase 1 comme complété

### Acceptance criteria
- [ ] `SELECT count(*) FROM venue WHERE deleted_at IS NULL` ≥ 60 000
- [ ] `SELECT family_slug, count(*) FROM venue GROUP BY family_slug` affiche les 13 familles avec des counts cohérents (raquette > 50k, ballon > 30k, etc.)
- [ ] `SELECT count(*) FROM venue WHERE geom IS NULL` = 0 (tout le monde a un point géographique)
- [ ] `SELECT count(*) FROM venue_sport` ≥ 80 000 (moyenne > 1 sport par venue)
- [ ] Une requête bbox Paris (`lon entre 2.25 et 2.42, lat entre 48.81 et 48.91`) retourne des venues dans les 200ms (index GIST actif)
- [ ] `SELECT count(*) FROM venue WHERE enrichments->>'v1_club_id' IS NULL` = 0 (traçabilité 100%)
- [ ] Build Vercel preview OK (la page Hello World du scaffold peut désormais afficher le count réel)

### Notes techniques
- Selon la taille de la DB SQLite V1, l'import peut prendre 10-30 minutes. Lancer dans un screen/tmux.
- Si l'import plante en cours, le script doit être idempotent (re-lançable sans doublons) grâce au `ON CONFLICT` sur `(source, external_id)`.
- Après l'import, lancer `VACUUM ANALYZE venue` dans le SQL Editor Supabase pour que le planner utilise les stats à jour.
- Si le count est inférieur à 60k, vérifier les familles `combat`, `snow`, `hike`, `plus` qui étaient marquées "coming soon" en V1 — elles peuvent avoir moins de données.
- Référence V1 counts : `data/spots-counts.json` dans le repo V1 (`sporthub-legacy`).

---

## Issue #7 — Page /sentry-test pour valider monitoring

**Labels** : `phase-1` `area:infra` `type:chore` `priority:p1`
**Estimate** : 2h
**Phase** : 1 (Fondations)
**Bloquée par** : #2

### Contexte
Sentry et PostHog sont configurés dans #2 via des env vars, mais sans page de validation dédiée, il est difficile de confirmer que le pipeline complet fonctionne en production (pas seulement en local). Cette page est temporaire — elle peut rester dans le codebase comme outil de diagnostic à l'usage exclusif des admins (protégée par un token secret ou accessible seulement en non-production).

### Tâches
- [ ] Créer `app/sentry-test/page.tsx` — page Server Component qui throw une erreur si le query param `?throw=1` est présent
- [ ] Créer `app/api/monitoring/sentry-test/route.ts` — endpoint GET qui throw une erreur côté serveur (pour tester le reporting server-side)
- [ ] Ajouter sur la page un bouton client-side qui trigger une erreur JavaScript côté browser (pour tester le reporting client-side)
- [ ] Afficher le count de venues depuis Supabase (`SELECT count(*) FROM venue`) — valide la connexion DB en même temps
- [ ] Protéger la page : accessible seulement si `NODE_ENV !== 'production'` OU si un header secret est présent
- [ ] Vérifier que l'erreur server-side apparaît dans Sentry avec le bon environment (`production` vs `preview`)

### Acceptance criteria
- [ ] Visiter `/sentry-test?throw=1` crée une issue dans Sentry dans les 60 secondes
- [ ] Cliquer le bouton "Throw client error" crée une issue Sentry de type `Error` côté browser
- [ ] Appeler `GET /api/monitoring/sentry-test` crée une issue Sentry de type server-side
- [ ] La page affiche le count réel de venues depuis Supabase (prouve que la connexion DB fonctionne)
- [ ] En production (`NODE_ENV=production` sans header secret), la page retourne 404 ou 403
- [ ] Build Vercel preview OK

### Notes techniques
- Pour Sentry Next.js App Router, le Server Component doit utiliser `Sentry.captureException()` ou simplement `throw new Error()` — les deux sont capturés si `instrumentation.ts` est configuré.
- Le count de venues affiché valide aussi que le client Supabase server-side fonctionne correctement en prod.
- Cette page est un diagnostic, pas une feature — la garder simple, pas de design.
- Référence Sentry : [Verify Sentry is configured correctly](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#step-5-verify)

---

## Issue #8 — Layout global : Nav + Footer + i18n placeholder (FR/EN)

**Labels** : `phase-2` `area:frontend` `type:feat` `priority:p1`
**Estimate** : 1d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #1

### Contexte
Toutes les pages partagent le même header (Nav) et footer. En V1, ce layout est copié-collé dans chaque fichier HTML — en V2, c'est un `layout.tsx` global avec des composants dédiés. L'i18n est un placeholder pour l'instant : le toggle FR/EN stocke la préférence en localStorage et recharge la page (identique au comportement cosmétique V1). Les vraies URLs `/en/*` seront une issue séparée.

### Tâches
- [ ] Créer `app/layout.tsx` avec les métadonnées globales (`viewport`, `themeColor`, `manifest`)
- [ ] Créer `components/layout/Nav.tsx` : logo SportHub, liens familles, toggle langue FR/EN, lien `/map`
- [ ] Créer `components/layout/Footer.tsx` : liens légaux, copyright, liens réseaux sociaux
- [ ] Créer `components/layout/I18nToggle.tsx` (Client Component) : stocke `lang` en localStorage, affiche FR/EN
- [ ] Appliquer les couleurs famille via des variables CSS `--f-*` dans le CSS global (`app/globals.css`)
- [ ] Créer `lib/i18n.ts` : dictionnaire minimal FR/EN pour les chaînes UI de Nav/Footer
- [ ] Tester responsive : Nav sur mobile doit avoir un hamburger menu (shadcn/ui `Sheet` ou `Drawer`)
- [ ] Vérifier que le `<html lang="fr">` est correctement positionné

### Acceptance criteria
- [ ] La Nav affiche le logo et les liens vers les 13 familles sur desktop
- [ ] Sur mobile (< 640px), la Nav affiche un hamburger qui ouvre un drawer latéral
- [ ] Le toggle FR/EN change les labels de la Nav sans rechargement de page (cosmétique)
- [ ] Le Footer contient au moins : copyright, lien CGU, lien Contact, lien GitHub (optionnel)
- [ ] Les 13 variables CSS `--f-*` sont définies dans `:root` de `globals.css`
- [ ] `pnpm build` passe sans erreur
- [ ] Lighthouse Accessibility ≥ 90 sur cette page (aria-labels sur les liens)

### Notes techniques
- Les couleurs `--f-*` sont définies dans `CLAUDE.md` section "Couleurs par famille" — les reprendre telles quelles.
- shadcn/ui `NavigationMenu` pour la Nav desktop, `Sheet` pour le drawer mobile.
- `lib/i18n.ts` : objet simple `{ fr: { map: 'Carte', ... }, en: { map: 'Map', ... } }` — pas de bibliothèque i18n pour l'instant (next-intl arrivera si on fait les vraies URLs `/en/*`).
- Packages : shadcn/ui est déjà installé depuis #1.

---

## Issue #9 — Route `/venue/[slug]` Server Component avec metadata SEO + schema.org SportsActivityLocation

**Labels** : `phase-2` `area:frontend` `area:seo` `type:feat` `priority:p0`
**Estimate** : 2d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #6 #8

### Contexte
La page détail venue est la page la plus importante pour le SEO : chaque venue a une URL indexable, un titre unique, et un schema.org `SportsActivityLocation` pour les rich results Google. En V1, ces pages n'existent pas — les users atterrissent sur les pages famille. V2 introduit une URL propre par venue (`/venue/[slug]`), ce qui est un avantage SEO majeur sur V1.

### Tâches
- [ ] Créer `app/venue/[slug]/page.tsx` en Server Component avec `async generateMetadata()`
- [ ] Implémenter la requête Supabase : `venue` + join `city`, `country`, `venue_sport`, `venue_amenity`, `booking_link` (cf. pattern dans `DATA_MODEL.md`)
- [ ] Implémenter `generateStaticParams()` pour pré-rendre les 1 000 venues les plus visités (les autres en ISR)
- [ ] Créer le composant `VenueHero` : nom, sport principal (emoji), adresse, pays, note Google si disponible
- [ ] Créer le composant `VenueSports` : liste des sports avec surface et nombre de courts
- [ ] Créer le composant `VenueAmenities` : grille icône + label des équipements
- [ ] Créer le composant `VenueBooking` : boutons de réservation (Anybuddy, Playtomic, Tenup) si `booking_link` présent
- [ ] Créer le composant `VenueMap` (Client Component) : mini-carte MapLibre centrée sur le venue, non-interactive (preview)
- [ ] Injecter le JSON-LD `SportsActivityLocation` via `<script type="application/ld+json">`
- [ ] Gérer le 404 si `slug` inexistant ou `is_published = false`

### Acceptance criteria
- [ ] `/venue/roland-garros-paris` (ou équivalent) rend sans erreur
- [ ] `<title>` = `{nom} — {sport} à {ville} | SportHub` (testé dans le DOM)
- [ ] `<meta name="description">` présent et ≤ 160 caractères
- [ ] `<link rel="canonical">` pointe vers `/venue/{slug}` absolu
- [ ] JSON-LD `SportsActivityLocation` valide via [Google Rich Results Test](https://search.google.com/test/rich-results) (copier le HTML)
- [ ] `latitude` et `longitude` présents dans le JSON-LD
- [ ] Un slug inexistant retourne un HTTP 404 (Next.js `notFound()`)
- [ ] Lighthouse Performance ≥ 90 sur cette page (mobile)
- [ ] Pas de regression sur les routes existantes

### Notes techniques
- Schema.org `SportsActivityLocation` : `@type`, `name`, `address` (PostalAddress), `geo` (GeoCoordinates), `sport`, `url`, `telephone`, `openingHours` si disponible.
- Utiliser `generateMetadata` async avec `fetch` Supabase (Server Component pur, pas de `useEffect`).
- `generateStaticParams` : requête SQL `ORDER BY enrichments->>'google_rating_count' DESC NULLS LAST LIMIT 1000` pour les venues les plus populaires.
- ISR pour le reste : `export const revalidate = 3600` (1h — acceptable pour des données de club qui changent peu, validé avec Gautier comme défini dans CLAUDE.md).
- La mini-carte `VenueMap` doit être un Client Component (`"use client"`) car MapLibre nécessite le DOM.
- Référence pattern SQL détail venue : `DATA_MODEL.md` section "Patterns d'usage typiques".

---

## Issue #10 — Route `/map` MapLibre + fetch venues bbox + clustering

**Labels** : `phase-2` `area:frontend` `type:feat` `priority:p0`
**Estimate** : 2d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #6 #8

### Contexte
La carte interactive est le coeur du produit — c'est la raison d'être de SportHub. En V1, Leaflet + markercluster charge tout le fichier `spots-{famille}.js` (jusqu'à 30 MB) côté client. V2 utilise MapLibre avec fetch bbox côté serveur : on ne charge QUE les venues visibles dans le viewport courant. C'est la fonctionnalité la plus complexe techniquement mais la plus critique pour la performance.

### Tâches
- [ ] Créer `app/map/page.tsx` (shell Server Component) qui inclut le composant carte Client Component
- [ ] Créer `components/map/MapView.tsx` (`"use client"`) : carte MapLibre plein écran avec tiles OpenStreetMap
- [ ] Créer `app/api/venues/route.ts` : endpoint GET qui accepte `?bbox=lon_sw,lat_sw,lon_ne,lat_ne&sports=tennis,padel&limit=500` et retourne les venues via la requête PostGIS bbox (cf. `DATA_MODEL.md`)
- [ ] Implémenter le clustering côté MapLibre (GeoJSON source + `cluster: true`) — pas de bibliothèque externe nécessaire
- [ ] Implémenter le rechargement des venues à chaque déplacement de carte (`moveend` event, debounce 300ms)
- [ ] Pins colorés par `family_slug` (utiliser les couleurs `--f-*` du CSS en dur dans le composant)
- [ ] Gérer le loading state (spinner pendant le fetch)
- [ ] Gérer les erreurs de fetch (toast via shadcn/ui)

### Acceptance criteria
- [ ] `/map` charge en < 2s sur desktop (réseau normal)
- [ ] `GET /api/venues?bbox=2.25,48.81,2.42,48.91` retourne des venues en JSON en < 500ms
- [ ] Les clusters se regroupent et s'ouvrent correctement au zoom
- [ ] Chaque cluster affiche le count de venues qu'il contient
- [ ] Les pins individuels sont colorés selon la famille du venue
- [ ] Déplacer la carte re-fetch les venues de la nouvelle zone (pas de rechargement de page)
- [ ] Sur mobile, la carte prend 100% de la hauteur disponible (sans overflow)
- [ ] Pas de chargement des 60k venues d'un coup (vérifiable dans Network tab : pas de réponse > 1 MB)
- [ ] Build Vercel preview OK

### Notes techniques
- MapLibre clustering natif : source GeoJSON avec `cluster: true`, `clusterMaxZoom: 14`, `clusterRadius: 50`. Pas besoin de bibliothèque externe — contrairement à Leaflet.markercluster.
- L'endpoint `GET /api/venues` doit utiliser le client Supabase avec la `SERVICE_ROLE_KEY` ou le client public — tester les deux, la RLS `is_published = true AND deleted_at IS NULL` est gérée par la policy existante.
- Debounce 300ms sur le `moveend` pour éviter de spammer l'API.
- Limiter à 500 venues par requête bbox (cf. requête dans `DATA_MODEL.md`) — afficher un message si la zone a plus de venues ("Zoomez pour voir plus de spots").
- Tiles OSM gratuites : `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — suffisant pour la V2. Basculer vers MapTiler ou Mapbox si l'esthétique doit être améliorée (issue séparée).

---

## Issue #11 — Filtres sport sur `/map` (sidebar gauche, équivalent V1)

**Labels** : `phase-2` `area:frontend` `type:feat` `priority:p1`
**Estimate** : 1d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #10

### Contexte
En V1, la sidebar de filtres sport est le principal outil de navigation sur la carte. L'utilisateur coche "Padel" et seuls les clubs padel apparaissent. V2 doit répliquer ce comportement avec la liste des sports organisée par famille, groupés et colorés. Le filtre passe en query param `?sports=tennis,padel` pour permettre le partage d'URL filtrée.

### Tâches
- [ ] Créer `components/map/SportsSidebar.tsx` (Client Component) : liste des sports groupés par famille
- [ ] Charger la liste des sports depuis l'endpoint `GET /api/sports` (ou directement depuis la table `sport` via Supabase client public)
- [ ] Implémenter la sélection multiple de sports (checkboxes) avec état local
- [ ] Synchroniser les filtres sélectionnés avec les query params URL (`?sports=tennis,padel`)
- [ ] Passer les sports sélectionnés au composant `MapView` qui re-fetche `GET /api/venues?sports=...`
- [ ] Implémenter le toggle "Tout sélectionner / Tout désélectionner" par famille
- [ ] Sur mobile, la sidebar se transforme en bottom sheet (shadcn/ui `Drawer`) accessible via un bouton flottant
- [ ] Persister les filtres en `sessionStorage` pour la durée de la session

### Acceptance criteria
- [ ] Cocher "Padel" et décocher "Tennis" affiche uniquement les venues padel
- [ ] Les filtres sont reflétés dans l'URL (`/map?sports=padel` est bookmarkable et donne le même résultat)
- [ ] `GET /api/venues?bbox=...&sports=padel` retourne uniquement des venues avec `sport_slug = 'padel'` dans `venue_sport`
- [ ] Les sports sont groupés par famille avec la couleur famille (`--f-raquette` pour Tennis, Padel, etc.)
- [ ] Sur mobile, le bouton "Filtres" ouvre un drawer depuis le bas
- [ ] Sélectionner 0 sport affiche un message "Sélectionnez un sport pour voir les spots"
- [ ] Build Vercel preview OK

### Notes techniques
- Utiliser `nuqs` ou `useSearchParams` + `router.push` pour la synchronisation URL — `nuqs` est plus pratique pour les arrays (`?sports=tennis,padel`).
- La liste des sports est statique (50+ entrées) — la fetch une fois au mount et la garder en mémoire (pas de re-fetch à chaque filtre).
- L'ordre des sports dans la sidebar doit suivre le champ `position` de la table `sport`.
- Package suggéré : `nuqs` pour la gestion des query params typés.

---

## Issue #12 — Popup au clic sur pin (Itinéraire, Partager, étoile favori)

**Labels** : `phase-2` `area:frontend` `type:feat` `priority:p1`
**Estimate** : 1d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #10

### Contexte
En V1, le clic sur un pin ouvre une popup avec les infos du venue et des actions clés. V2 doit implémenter la même UX avec trois groupes d'actions : Itinéraire (Google Maps, Apple Plans, Waze), Partager (WhatsApp, Copier le lien), et l'étoile favoris (localStorage pour les anonymes, DB pour les users connectés en Phase 3). La popup doit être mobile-friendly.

### Tâches
- [ ] Créer `components/map/VenuePopup.tsx` (Client Component) : popup MapLibre avec les infos du venue
- [ ] Afficher : nom, sport principal (emoji), adresse, distance approximative (si géolocalisation browser activée)
- [ ] Section "Itinéraire" : dropdown avec liens Google Maps (`https://maps.google.com/?q={lat},{lon}`), Apple Plans (`maps://...`), Waze (`https://waze.com/ul?ll={lat},{lon}`)
- [ ] Section "Partager" : dropdown avec lien WhatsApp (`https://wa.me/?text={url}`), bouton "Copier le lien" (Clipboard API)
- [ ] Étoile favori : toggle `localStorage.getItem('favorites')` array de slugs (pour Phase 2, avant Auth)
- [ ] Lien "Voir la fiche complète" → `/venue/[slug]`
- [ ] Fermeture au clic en dehors de la popup
- [ ] Animation d'ouverture (fade-in 150ms)

### Acceptance criteria
- [ ] Cliquer sur un pin ouvre la popup avec le nom et le sport du venue
- [ ] Le lien "Google Maps" ouvre Google Maps centré sur le venue dans un nouvel onglet
- [ ] Le lien "Waze" ouvre Waze avec les coordonnées du venue
- [ ] Le bouton "Copier le lien" copie `https://sporthubmap.com/venue/{slug}` dans le presse-papier
- [ ] Cliquer l'étoile favori ajoute le slug à `localStorage.favorites` (vérifiable dans DevTools)
- [ ] La popup se ferme en cliquant en dehors
- [ ] La popup est lisible sur mobile (largeur ≥ 300px, texte ≥ 14px)
- [ ] Checklist parité V1 : popup a Itinéraire (Google+Apple+Waze), Partager (WhatsApp+Copy), étoile — cf. `MIGRATION.md`
- [ ] Build Vercel preview OK

### Notes techniques
- MapLibre `Popup` : utiliser `new maplibregl.Popup()` avec `setDOMContent()` pour injecter le composant React (via `createPortal` ou `ReactDOM.render` dans un container div).
- Alternative plus propre : [react-map-gl `Popup` component](https://visgl.github.io/react-map-gl/docs/api-reference/popup) qui gère le cycle de vie React correctement.
- Le lien Apple Plans fonctionne sur iOS uniquement — sur Android, afficher uniquement Google Maps + Waze.
- Pour détecter iOS : `navigator.userAgent` (acceptable ici, c'est juste un lien de deep-link).
- Le partage WhatsApp encode l'URL : `encodeURIComponent(window.location.origin + '/venue/' + slug)`.

---

## Issue #13 — Recherche ville (Nominatim ou Mapbox Geocoding)

**Labels** : `phase-2` `area:frontend` `type:feat` `priority:p1`
**Estimate** : 1d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #10

### Contexte
En V1, il n'y a pas de recherche ville intégrée à la carte — l'utilisateur doit naviguer manuellement. V2 ajoute une barre de recherche ville qui centre la carte sur la ville saisie. On utilise Nominatim (OpenStreetMap, gratuit) en priorité, avec Mapbox Geocoding en fallback payant si les résultats sont insuffisants pour des villes non-françaises.

### Tâches
- [ ] Créer `components/map/CitySearch.tsx` (Client Component) : input texte avec autocomplete
- [ ] Implémenter la recherche Nominatim : `GET https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=5`
- [ ] Debounce 400ms sur la saisie pour ne pas spammer Nominatim
- [ ] Afficher les suggestions dans un dropdown (shadcn/ui `Popover` ou `Command`)
- [ ] Au clic sur une suggestion, centrer la carte sur les coordonnées et zoomer à level 12
- [ ] Créer `app/api/geocode/route.ts` pour proxifier Nominatim (ajouter le `User-Agent` requis par Nominatim, éviter CORS)
- [ ] Gérer le cas "aucun résultat" avec un message
- [ ] Positionner le composant en overlay sur la carte (coin supérieur gauche)

### Acceptance criteria
- [ ] Taper "Paris" affiche au moins une suggestion "Paris, France"
- [ ] Sélectionner une suggestion centre la carte sur Paris (lat ~48.85, lon ~2.35) et zoom ≥ 11
- [ ] `GET /api/geocode?q=Paris` retourne du JSON avec `lat`, `lon`, `display_name` dans les 1 000ms
- [ ] Le debounce est actif : taper rapidement ne génère pas plus de 1 requête par 400ms (vérifiable en Network tab)
- [ ] Le composant est lisible sur mobile (largeur ≥ 280px)
- [ ] Aucune requête Nominatim ne part directement du browser (tout passe par `/api/geocode`)
- [ ] Build Vercel preview OK

### Notes techniques
- Nominatim impose un `User-Agent` identifiant l'application et un délai entre requêtes — raison pour laquelle on proxy via `/api/geocode` plutôt que d'appeler Nominatim directement depuis le browser.
- Rate limit Nominatim : 1 req/s. Le debounce 400ms côté client + le proxy protège contre les abus accidentels.
- Si Nominatim ne suffit pas (résultats trop faibles sur des villes hors France), envisager Photon (`https://photon.komoot.io/api/`) qui est aussi gratuit et basé sur OSM.
- Ne pas utiliser Mapbox Geocoding en V2 (payant, budget non défini) — mais prévoir la variable d'env `MAPBOX_TOKEN` dans `.env.example` pour faciliter la migration future.

---

## Issue #14 — Route `/sports/[sport]` (page sport global, liste paginée + carte preview)

**Labels** : `phase-2` `area:frontend` `area:seo` `type:feat` `priority:p1`
**Estimate** : 1d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #9

### Contexte
`/sports/[sport]` remplace les pages famille V1 (`/family-raquette.html`, etc.). C'est une page hybride : liste paginée des venues pour ce sport en France + une carte preview MapLibre. Ces pages sont des cibles SEO importantes (ex: "tous les clubs de padel France"). Le mapping URL V1 → V2 est défini dans `MIGRATION.md`.

### Tâches
- [ ] Créer `app/sports/[sport]/page.tsx` Server Component avec `generateMetadata` dynamique
- [ ] Charger les infos du sport depuis la table `sport` (nom FR/EN, famille, emoji, couleur)
- [ ] Charger la liste paginée des venues via Supabase (50 par page, `ORDER BY courts_count DESC NULLS LAST`)
- [ ] Implémenter la pagination côté serveur (query param `?page=N`)
- [ ] Créer le composant `VenueCard` : nom, ville, sport, courts_count, photo si disponible (`enrichments.photo_url`)
- [ ] Afficher le count total de venues pour ce sport
- [ ] Inclure une mini-carte MapLibre en preview (Client Component, non-interactive, centrée sur France par défaut)
- [ ] `generateStaticParams()` pour les 13 family_slugs principaux (pré-rendu)
- [ ] Ajouter les redirects V1 dans `next.config.js` : `/family-raquette.html` → `/sports/raquette` (permanent: true)

### Acceptance criteria
- [ ] `/sports/raquette` charge et affiche une liste de venues tennis/padel/badminton/etc.
- [ ] `/sports/yoga` affiche les venues yoga (slug interne `yoga` = "Bien-être" en display — cf. CLAUDE.md)
- [ ] `<title>` = `Clubs de {sport} en France — SportHub` (localisé)
- [ ] `<link rel="canonical">` correct
- [ ] La pagination fonctionne : `/sports/padel?page=2` affiche la page 2
- [ ] Un `<nav aria-label="pagination">` est présent (SEO + accessibilité)
- [ ] `/family-raquette.html` redirige en 301 vers `/sports/raquette` (vérifiable avec `curl -I`)
- [ ] Lighthouse SEO ≥ 90
- [ ] Pas de regression sur les routes existantes

### Notes techniques
- Le slug `yoga` en DB correspond à la famille, pas au sport individuel — la requête filtre sur `venue.family_slug = 'yoga'` pour la page famille, ou sur `venue_sport.sport_slug = 'yoga'` pour le sport précis. Clarifier avec Gautier si la route `/sports/yoga` = page famille ou page sport individuel.
- Les redirects V1 dans `next.config.js` : utiliser un pattern générique `{ source: '/family-:slug.html', destination: '/sports/:slug', permanent: true }` — couvre toutes les familles d'un coup.
- Pour la mini-carte preview : charger max 200 venues à zoom national, clusters activés, non-interactive (`interactive: false` dans MapLibre).
- `VenueCard` : utiliser `next/image` pour la photo (si disponible), avec fallback vers l'emoji sport.

---

## Issue #15 — Route `/[sport]/[country]/[city]` (pages programmatiques sport × ville)

**Labels** : `phase-2` `area:frontend` `area:seo` `type:feat` `priority:p0`
**Estimate** : 2d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #14

### Contexte
Les pages programmatiques sport × ville (`/padel/fr/paris`, `/tennis/fr/lyon`) sont le principal levier SEO de SportHub. En V1, elles sont générées statiquement par `scripts/programmatic/build.py` (~10 pages POC). V2 génère ces pages dynamiquement depuis Supabase, avec des metadata uniques, des données réelles et un potentiel de ~150 pages France en Phase 2, extensible à l'international. C'est la route la plus importante après `/venue/[slug]` pour le SEO.

### Tâches
- [ ] Créer `app/[sport]/[country]/[city]/page.tsx` Server Component avec `generateMetadata` dynamique
- [ ] Valider que `sport`, `country`, `city` existent en DB (sinon 404 avec `notFound()`)
- [ ] Charger les venues correspondants via la requête SQL dans `DATA_MODEL.md` section "Liste paginée 'padel à Paris'"
- [ ] Afficher : titre H1, count de venues, liste paginée (50 par page), mini-carte MapLibre
- [ ] `generateStaticParams()` : pré-rendre les combinaisons sport × ville avec ≥ 10 venues (requête SQL `GROUP BY` pour les trouver)
- [ ] Ajouter les redirects V1 programmatiques dans `next.config.js` (`/padel-paris.html` → `/padel/fr/paris`, etc.)
- [ ] Ajouter les balises hreflang FR/EN dans les métadonnées (placeholder EN pour l'instant)
- [ ] Créer `app/[sport]/[country]/[city]/opengraph-image.tsx` avec l'OG image dynamique via `next/og`

### Acceptance criteria
- [ ] `/padel/fr/paris` charge et affiche les clubs padel à Paris avec le bon count
- [ ] `/tennis/fr/lyon` charge et affiche les clubs tennis à Lyon
- [ ] Un slug invalide (ex: `/padel/fr/atlantis`) retourne un HTTP 404
- [ ] `<title>` = `Clubs de padel à Paris ({count} adresses) | SportHub`
- [ ] `<meta name="description">` unique et ≤ 160 caractères, contient ville + sport + count
- [ ] `<link rel="canonical">` = `https://sporthubmap.com/padel/fr/paris`
- [ ] `/padel-paris.html` redirige en 301 vers `/padel/fr/paris` (cf. liste complète dans `MIGRATION.md`)
- [ ] `pnpm build` génère les pages statiques pour les combinaisons principales (visible dans le log de build)
- [ ] OG image affiche "Padel à Paris" avec le style SportHub

### Notes techniques
- Mapping complet des redirects V1 → V2 : `MIGRATION.md` section "Mapping URLs V1 → V2". Toutes les 10 pages POC V1 doivent avoir leur redirect.
- `generateStaticParams()` : la requête SQL pour trouver les combinaisons avec ≥ 10 venues : `SELECT vs.sport_slug, v.country_code, c.slug AS city_slug, count(*) FROM venue v JOIN venue_sport vs ON vs.venue_id = v.id JOIN city c ON c.id = v.city_id WHERE v.is_published = true AND v.deleted_at IS NULL GROUP BY 1,2,3 HAVING count(*) >= 10`.
- OG image dynamique : `app/[sport]/[country]/[city]/opengraph-image.tsx` avec `ImageResponse` de `next/og` — afficher l'emoji sport, le nom ville, le count.
- `revalidate = 86400` (24h) acceptable ici — les counts de venues ne changent pas à chaque minute.

---

## Issue #16 — Sitemap dynamique généré depuis Supabase

**Labels** : `phase-2` `area:seo` `type:feat` `priority:p1`
**Estimate** : 4h
**Phase** : 2 (Lecture parité)
**Bloquée par** : #15

### Contexte
Le sitemap V1 est statique (`sitemap.xml`, 26 URLs). V2 a des milliers d'URLs : une par venue + les pages programmatiques. Un sitemap dynamique est indispensable pour que Google découvre et indexe toutes ces pages. Next.js 14 a un mécanisme natif via `app/sitemap.ts` qui génère le XML à la demande.

### Tâches
- [ ] Créer `app/sitemap.ts` qui retourne un tableau d'objets `MetadataRoute.Sitemap`
- [ ] Inclure les pages statiques : `/`, `/map`, `/login`, `/favoris`, les 13 `/sports/{family}`
- [ ] Inclure les pages venue : requête Supabase `SELECT slug, updated_at FROM venue WHERE is_published = true AND deleted_at IS NULL` (paginée par batch de 1000)
- [ ] Inclure les pages programmatiques : requête combinaisons sport × pays × ville actives
- [ ] Configurer les priorités : `/` → 1.0, `/venue/*` → 0.8, `/sports/*` → 0.7, programmatiques → 0.9
- [ ] Configurer `changefreq` : venues → `weekly`, pages famille → `monthly`
- [ ] Vérifier que `https://sporthubmap.com/sitemap.xml` est accessible (ou `/sitemap-0.xml` si paginé)
- [ ] Soumettre le sitemap dans la Google Search Console V2 (action manuelle, documenter dans `MIGRATION.md`)

### Acceptance criteria
- [ ] `GET /sitemap.xml` retourne un XML valide avec `Content-Type: application/xml`
- [ ] Le sitemap contient au moins 60 000 URLs (une par venue publié)
- [ ] Toutes les URLs commencent par `https://sporthubmap.com` (pas `http://`, pas `localhost`)
- [ ] Les priorités sont cohérentes (/ = 1.0, venue = 0.8)
- [ ] Le sitemap passe la validation [XML Sitemap Validator](https://www.xml-sitemaps.com/validate-xml-sitemap.html)
- [ ] `pnpm build` ne timeout pas (le sitemap est généré à la demande, pas au build)
- [ ] Build Vercel preview OK

### Notes techniques
- Avec 60k+ URLs, le sitemap sera probablement > 50 MB (limite Google : 50 MB / 50 000 URLs par fichier). Utiliser un sitemap index avec plusieurs fichiers si nécessaire — Next.js le gère via `generateSitemaps()`.
- Référence : [Next.js sitemap docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap#generating-a-sitemap-using-code-js-ts)
- Le fetch Supabase du sitemap doit utiliser la `SERVICE_ROLE_KEY` (bypass RLS pour lister toutes les URLs — la RLS lécture publique suffit mais peut être plus lente). À tester.
- `revalidate = 3600` pour le sitemap (régénéré toutes les heures) — acceptable.

---

## Issue #17 — Polish mobile + Lighthouse > 90 sur 5 pages clés + OG images + hreflang

**Labels** : `phase-2` `area:frontend` `area:seo` `type:perf` `priority:p1`
**Estimate** : 2d
**Phase** : 2 (Lecture parité)
**Bloquée par** : #9 #10 #14 #15 #16

### Contexte
Issue de polish de fin de Phase 2. Avant de commencer la Phase 3, les 5 pages les plus importantes doivent passer les critères de performance Lighthouse, les OG images doivent être générées correctement pour le partage social, et le hreflang doit être en place (même cosmétique). C'est la gate avant de considérer V2 en parité de lecture avec V1.

### Tâches
- [ ] Auditer Lighthouse sur : `/`, `/map`, `/venue/{slug-populaire}`, `/sports/raquette`, `/padel/fr/paris`
- [ ] Corriger les régressions Performance < 90 (images non optimisées, bundle JS trop lourd, etc.)
- [ ] Vérifier que `next/image` est utilisé partout où des images s'affichent (pas de `<img>` brut)
- [ ] Ajouter les balises `hreflang` sur toutes les pages (`fr`, `en`, `x-default`) via `generateMetadata`
- [ ] Créer une `opengraph-image.tsx` par famille (13 images) ou une dynamique avec `next/og`
- [ ] Vérifier que `<meta property="og:image">` pointe vers l'OG image correcte sur chaque page
- [ ] Vérifier que le partage sur WhatsApp/Twitter affiche le bon titre + image + description
- [ ] Vérifier le rendu mobile sur Chrome DevTools (iPhone 14 Pro, 390px viewport)
- [ ] S'assurer que LCP < 2.5s sur mobile 4G (throttle dans DevTools)
- [ ] Mettre à jour `ROADMAP.md` : marquer Phase 2 comme complétée

### Acceptance criteria
- [ ] Lighthouse Performance ≥ 90 sur les 5 pages cibles (mobile)
- [ ] Lighthouse SEO ≥ 90 sur les 5 pages cibles
- [ ] Lighthouse Accessibility ≥ 90 sur les 5 pages cibles
- [ ] LCP < 2.5s sur `/`, `/venue/{slug}`, `/padel/fr/paris` (mobile 4G simulé)
- [ ] Bundle JS initial < 200 KB gzip (vérifiable via `pnpm build` output ou `next-bundle-analyzer`)
- [ ] Partager `/padel/fr/paris` sur WhatsApp affiche titre + image + description corrects
- [ ] `<link rel="alternate" hreflang="fr">` et `hreflang="en"` présents sur toutes les pages (vérifiable avec `curl {url} | grep hreflang`)
- [ ] Checklist parité `MIGRATION.md` : OG images dédiées + hreflang cochés

### Notes techniques
- Pour l'analyse de bundle : `ANALYZE=true pnpm build` avec `@next/bundle-analyzer` installé.
- OG images dynamiques avec `next/og` (`ImageResponse`) sont générées à la demande et cachées par Vercel — pas de génération statique nécessaire.
- hreflang : pour l'instant, l'URL EN pointe vers la même URL FR (les vraies URLs `/en/*` sont hors-scope Phase 2). Google accepte `hreflang="en"` pointant vers la même URL — c'est honnête si le contenu est en français mais l'audience est internationale.
- LCP : la principale source de régression sera la photo venue (si `enrichments.photo_url` est présent) — s'assurer d'utiliser `priority` prop sur `next/image` pour le LCP element.
- Référence : checklist parité V1 dans `MIGRATION.md` section "SEO".

---

## Issue #18 — Auth Supabase (magic link + Google OAuth) + page /login

**Labels** : `phase-3` `area:auth` `type:feat` `priority:p0`
**Estimate** : 1d
**Phase** : 3 (Écriture & admin)
**Bloquée par** : #8

### Contexte
Phase 3 introduit les fonctionnalités nécessitant une identité utilisateur : claim de fiche, admin, favoris persistés. Supabase Auth gère nativement le magic link (email) et Google OAuth. La page `/login` est minimaliste : deux boutons. La session est gérée côté Next.js via les cookies de Supabase SSR.

### Tâches
- [ ] Activer Google OAuth dans le Dashboard Supabase Auth → Providers → Google (client ID + secret depuis Google Cloud Console)
- [ ] Créer `app/login/page.tsx` : bouton "Connexion avec Google" + champ email pour magic link
- [ ] Créer `app/api/auth/callback/route.ts` pour gérer le callback OAuth/magic link (échange du code contre une session)
- [ ] Créer `middleware.ts` à la racine : refresh de la session Supabase sur chaque requête (pattern SSR officiel)
- [ ] Créer `lib/auth.ts` : helpers `getUser()`, `requireUser()` (redirect vers /login si non-authentifié), `isAdmin()`
- [ ] Afficher l'email et un bouton "Déconnexion" dans la Nav si l'utilisateur est connecté
- [ ] Créer `app/auth/logout/route.ts` : action de déconnexion (POST, invalide la session)
- [ ] Créer `app/auth/magic-link-sent/page.tsx` : page de confirmation "Vérifiez vos emails"

### Acceptance criteria
- [ ] Saisir un email et cliquer "Connexion" envoie un magic link (email reçu dans les 60s)
- [ ] Cliquer le magic link connecte l'utilisateur et redirige vers `/`
- [ ] Cliquer "Connexion avec Google" redirige vers Google OAuth et connecte après consentement
- [ ] `getUser()` dans un Server Component retourne le user ou `null` (pas d'exception)
- [ ] La Nav affiche l'email de l'utilisateur connecté
- [ ] Cliquer "Déconnexion" efface la session et redirige vers `/`
- [ ] `requireUser()` redirige vers `/login` si appelé sans session active
- [ ] Build Vercel preview OK

### Notes techniques
- Utiliser le package `@supabase/ssr` (et NON `@supabase/auth-helpers-nextjs` qui est déprécié).
- Le `middleware.ts` doit appeler `supabase.auth.getUser()` sur chaque requête pour rafraîchir le token — sans ça, la session expire silencieusement.
- Google OAuth : dans Google Cloud Console, créer un projet, activer "Google+ API", créer des credentials OAuth 2.0. L'URL de callback Supabase est `https://{project-ref}.supabase.co/auth/v1/callback`.
- Référence officielle : [Supabase Auth SSR Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- L'email admin à whitelister pour l'accès `/admin` : `gautier.no@gmail.com` — à configurer via `isAdmin()` qui vérifie `user.email` ou un claim JWT custom.

---

## Issue #19 — Layout `/admin` protégé + page `/admin/venues` CRUD basique

**Labels** : `phase-3` `area:admin` `area:frontend` `type:feat` `priority:p1`
**Estimate** : 2d
**Phase** : 3 (Écriture & admin)
**Bloquée par** : #18

### Contexte
L'interface admin permet à Gautier de modérer les venues, corriger des données, approuver des claims. En V1, il n'y a pas d'admin — tout se fait via des scripts Python. V2 introduit un CRUD basique sur `/admin/venues`. Le layout admin est protégé par le check `isAdmin()` (email whitelist en Phase 3, JWT custom claims en Phase 4+).

### Tâches
- [ ] Créer `app/admin/layout.tsx` : protège toutes les routes `/admin/*` via `requireUser()` + `isAdmin()` (redirect vers `/login` si non-admin)
- [ ] Créer `app/admin/page.tsx` : dashboard minimaliste avec stats (count venues, count claims, count users)
- [ ] Créer `app/admin/venues/page.tsx` : table paginée des venues avec colonnes nom, slug, ville, famille, is_published, claim_status
- [ ] Implémenter la recherche par nom dans la table admin (input → re-fetch avec `?q=roland`)
- [ ] Créer `app/admin/venues/[id]/edit/page.tsx` : formulaire d'édition des champs principaux (nom, adresse, website_url, is_published, description)
- [ ] Créer `app/api/admin/venues/[id]/route.ts` : PATCH endpoint pour l'update (utilise `SERVICE_ROLE_KEY`, bypass RLS)
- [ ] Créer `app/api/admin/venues/[id]/route.ts` : soft-delete (PATCH `deleted_at = NOW()`, jamais DELETE physique — cf. CLAUDE.md)
- [ ] Afficher un breadcrumb de navigation dans le layout admin
- [ ] Logger les actions admin dans les logs Sentry (user + action + venue_id)

### Acceptance criteria
- [ ] `/admin` redirige vers `/login` si l'utilisateur n'est pas connecté
- [ ] `/admin` redirige vers `/` (ou 403) si l'utilisateur est connecté mais non-admin
- [ ] `gautier.no@gmail.com` a accès à `/admin/venues`
- [ ] La table `/admin/venues` affiche les 50 premiers venues avec pagination
- [ ] Rechercher "roland" filtre les venues dont le nom contient "roland" (insensible à la casse)
- [ ] Modifier le champ `is_published` d'un venue via le formulaire d'édition et sauvegarder fonctionne
- [ ] Soft-delete d'un venue : `deleted_at IS NOT NULL` en DB, le venue n'apparaît plus sur `/map`
- [ ] `PATCH /api/admin/venues/{id}` retourne 403 si appelé sans session admin (RLS bypass via service_role uniquement côté serveur)
- [ ] Build Vercel preview OK

### Notes techniques
- shadcn/ui `DataTable` (basé sur TanStack Table) pour la liste des venues — prêt à l'emploi, filtrage et pagination inclus.
- Le formulaire d'édition : shadcn/ui `Form` + `react-hook-form` + `zod` pour la validation.
- Le PATCH endpoint admin doit utiliser le client Supabase avec `SERVICE_ROLE_KEY` (côté serveur uniquement) pour bypasser la RLS et mettre à jour n'importe quel venue, même non-claimed.
- Ne pas oublier : le trigger `trg_venue_updated_at` met à jour `updated_at` automatiquement à chaque PATCH.
- `isAdmin()` en Phase 3 : `user.email === process.env.ADMIN_EMAIL` — simple mais fonctionnel. Ajouter `ADMIN_EMAIL=gautier.no@gmail.com` dans `.env.example`.
- Packages : `@tanstack/react-table`, `react-hook-form`, `zod` (probablement déjà installés via shadcn).

---

## Issue #20 — Formulaire `/venue/[slug]/claim` + page `/admin/claim-requests` avec workflow approval

**Labels** : `phase-3` `area:frontend` `area:admin` `type:feat` `priority:p1`
**Estimate** : 2d
**Phase** : 3 (Écriture & admin)
**Bloquée par** : #18 #19

### Contexte
Le claim de fiche permet à un gérant de club de revendiquer sa fiche SportHub pour la mettre à jour. C'est la fonctionnalité différenciante de V2 par rapport à V1 (impossible en vanilla HTML). Le workflow est simple : le gérant soumet un formulaire → Gautier review dans `/admin/claim-requests` → approve ou reject → le gérant peut éditer sa fiche. La preuve (PDF, photo) est uploadée dans Supabase Storage.

### Tâches
- [ ] Créer `app/venue/[slug]/claim/page.tsx` : formulaire avec champs `requester_name`, `requester_role` (owner/manager/marketing), `proof_text`, `proof_url` (upload fichier)
- [ ] Implémenter l'upload de preuve vers Supabase Storage (bucket `claim-proofs`, privé) via un Client Component
- [ ] Créer `app/api/claims/route.ts` : POST endpoint qui insère dans `claim_request` (RLS : `auth.uid() IS NOT NULL`)
- [ ] Mettre à jour `venue.claim_status = 'pending'` après soumission (via la même route API)
- [ ] Créer `app/admin/claim-requests/page.tsx` : liste des claims avec status (pending/approved/rejected), filtrable
- [ ] Créer `app/admin/claim-requests/[id]/page.tsx` : détail d'un claim avec lien vers la preuve + boutons Approve / Reject
- [ ] Créer `app/api/admin/claims/[id]/approve/route.ts` : POST → `claim_request.status = 'approved'`, `venue.claim_status = 'verified'`, `venue.claimed_by = requester_user_id`
- [ ] Créer `app/api/admin/claims/[id]/reject/route.ts` : POST → `claim_request.status = 'rejected'` + `notes`
- [ ] Envoyer un email de notification au demandeur à l'approbation (via Supabase Edge Function ou Resend API)
- [ ] Gérer le cas où le venue est déjà claimed (`claim_status = 'verified'`) — afficher un message et bloquer la soumission

### Acceptance criteria
- [ ] Un utilisateur connecté peut soumettre un claim sur `/venue/{slug}/claim`
- [ ] La soumission insère une ligne dans `claim_request` avec `status = 'pending'`
- [ ] `venue.claim_status` passe à `'pending'` après soumission
- [ ] La preuve PDF/image uploadée est accessible dans le bucket Supabase Storage `claim-proofs` (URL temporaire signée)
- [ ] `/admin/claim-requests` affiche tous les claims avec leur status
- [ ] Cliquer "Approuver" dans l'admin met `claim_request.status = 'approved'` et `venue.claim_status = 'verified'` et `venue.claimed_by = requester_user_id` en une transaction atomique
- [ ] Cliquer "Rejeter" avec notes met `claim_request.status = 'rejected'` avec `notes` rempli
- [ ] Le demandeur reçoit un email de notification à l'approbation (vérifiable en dev via les logs Supabase)
- [ ] Un venue avec `claim_status = 'verified'` affiche un badge "Fiche vérifiée" sur `/venue/[slug]`
- [ ] RLS : un utilisateur ne peut pas lire les claims d'un autre utilisateur (`requester_user_id = auth.uid()`)
- [ ] Build Vercel preview OK

### Notes techniques
- Supabase Storage bucket `claim-proofs` : créer en mode **privé** (pas public) — générer des URLs signées via `supabase.storage.from('claim-proofs').createSignedUrl(path, 3600)` pour que l'admin puisse voir la preuve.
- Pour l'atomicité approve : exécuter les deux UPDATEs dans une transaction via `supabase.rpc('approve_claim', { claim_id })` (créer une Supabase Function SQL pour ça).
- Email notification : utiliser Supabase Edge Functions avec le SDK Resend (`npm install resend`) — ajouter `RESEND_API_KEY` dans `.env.example`.
- Formulaire de claim : accessible sans être connecté (affiche juste le formulaire), mais la soumission redirige vers `/login` si non-connecté (géré par `requireUser()` dans la route API).
- La table `claim_request` a `requester_email TEXT NOT NULL` en plus du `requester_user_id` — utile pour les claims soumis avant que l'utilisateur ait confirmé son email.

---

## Comment créer ces issues en masse sur GitHub

> Pré-requis : `gh` CLI installé et authentifié (`gh auth login`). Être dans le repo V2.

### Étape 1 — Splitter ce fichier en fichiers individuels

```bash
# Script de découpage — à lancer depuis la racine du repo V2
cd /Users/gautier/Documents/Claude/Projects/SportHub/v2-scaffold

python3 - <<'EOF'
import re, os

with open("ISSUES.md") as f:
    content = f.read()

# Découper sur les titres "## Issue #N"
parts = re.split(r'(?=^## Issue #\d+)', content, flags=re.MULTILINE)

os.makedirs("issues-tmp", exist_ok=True)
for part in parts:
    m = re.match(r'^## Issue #(\d+)', part)
    if m:
        num = int(m.group(1))
        fname = f"issues-tmp/issue-{num:02d}.md"
        with open(fname, "w") as out:
            out.write(part.strip())
        print(f"Wrote {fname}")
EOF
```

### Étape 2 — Créer les issues sur GitHub

```bash
# Une fois les fichiers splitté dans issues-tmp/ :
for f in issues-tmp/issue-*.md; do
  # Extraire le titre (première ligne, sans "## Issue #N — ")
  title=$(head -1 "$f" | sed 's/^## Issue #[0-9]* — //')

  # Extraire les labels depuis la ligne "**Labels** : ..."
  labels_raw=$(grep '^\*\*Labels\*\*' "$f" | sed 's/\*\*Labels\*\* : //' | tr -d '`' | tr ' ' '\n' | tr -d '\r')

  # Convertir en format --label "label1" --label "label2"
  label_args=""
  for label in $labels_raw; do
    [ -n "$label" ] && label_args="$label_args --label \"$label\""
  done

  echo "Creating: $title"
  eval gh issue create \
    --title "\"$title\"" \
    --body-file "\"$f\"" \
    $label_args

  # Pause entre chaque issue pour éviter le rate limiting GitHub
  sleep 2
done
```

### Étape 3 — Nettoyer les fichiers temporaires

```bash
rm -rf issues-tmp/
```

### One-liner simplifié (sans gestion des labels)

```bash
# Version minimaliste si vous voulez juste créer les issues rapidement
# et ajouter les labels manuellement sur GitHub ensuite :
for f in issues-tmp/issue-*.md; do
  title=$(head -1 "$f" | sed 's/^## Issue #[0-9]* — //')
  gh issue create --title "$title" --body-file "$f"
  sleep 2
done
```

### Créer les labels sur GitHub avant de créer les issues

```bash
# Labels phase
gh label create "phase-1" --color "0052cc" --description "Phase 1 : Fondations"
gh label create "phase-2" --color "0075ca" --description "Phase 2 : Lecture parité"
gh label create "phase-3" --color "e4e669" --description "Phase 3 : Écriture & admin"

# Labels area
gh label create "area:backend"   --color "d4c5f9" --description "Supabase, API routes, DB"
gh label create "area:frontend"  --color "bfd4f2" --description "Composants, pages, UI"
gh label create "area:data"      --color "f9d0c4" --description "Import, migrations, scripts"
gh label create "area:infra"     --color "c5def5" --description "Vercel, monitoring, CI/CD"
gh label create "area:seo"       --color "fef2c0" --description "SEO, sitemap, schema.org"
gh label create "area:auth"      --color "e4c6f5" --description "Supabase Auth, sessions"
gh label create "area:admin"     --color "f5d5c6" --description "Dashboard admin"

# Labels priority
gh label create "priority:p0" --color "d73a4a" --description "Bloquant, à traiter immédiatement"
gh label create "priority:p1" --color "e99695" --description "Important, sprint courant"
gh label create "priority:p2" --color "f9d0c4" --description "Nice-to-have, prochain sprint"

# Labels type
gh label create "type:feat"   --color "a2eeef" --description "Nouvelle fonctionnalité"
gh label create "type:chore"  --color "ffffff" --description "Setup, config, infra"
gh label create "type:perf"   --color "84b6eb" --description "Performance, Lighthouse"
```
