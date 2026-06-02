# SportHub V2 — contexte pour Claude Code

## Contexte produit

SportHub est une carte interactive mondiale qui aide les sportifs à trouver
où pratiquer : tennis, padel, surf, yoga, foot, pétanque, etc. Les données
proviennent de bases publiques (OSM, RES France, Wikidata, Overture). 267 000
spots indexés dans 13 familles de sport.

**Le site actuel (V1, vanilla HTML/JS + SQLite + Leaflet) tourne à sporthubmap.com.**
On migre vers cette V2 (Next.js 14 App Router + Supabase + MapLibre). V1
reste live pendant toute la migration. La bascule se fera par 301 quand V2
aura dépassé V1 sur les métriques clés (parité SEO + features).

## Stack V2

| Couche      | Tech                                                        |
| ----------- | ----------------------------------------------------------- |
| Framework   | Next.js 14 (App Router) + TypeScript strict                 |
| Styling     | Tailwind CSS + shadcn/ui                                    |
| Carte       | MapLibre GL + react-map-gl                                  |
| Backend     | Supabase (Postgres + Auth + Storage + Realtime)             |
| Hosting     | Vercel (preview URL par PR)                                 |
| Monitoring  | Sentry (erreurs) + PostHog (analytics produit)              |
| Source data | `data-pipeline/data/sportpin.sqlite` (V1, en lecture seule) |

## Règles de travail strictes

1. **Une PR = une issue.** Pas de PR sans issue GitHub liée. Ferme l'issue via `Closes #N`.
2. **Pas de breaking change sur les routes existantes** sans entrée explicite dans `MIGRATION.md`.
3. **Variables d'env obligatoires** : tout secret va dans `.env.local` (jamais commit). `.env.example` documente les variables nécessaires.
4. **TypeScript strict.** Pas de `any` sauf justification dans le commit message.
5. **Server Components par défaut.** Client Components (`"use client"`) seulement si interaction utilisateur ou hooks.
6. **Pas de fake data en prod.** Pour le dev local, utiliser `supabase/seed.sql`.
7. **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`.
8. **Avant tout refactor majeur**, demander à Gautier (commenter sur l'issue avant de coder).
9. **Tests** : pas obligatoires pour les pages, **obligatoires pour les helpers** (`lib/`).
10. **Cap PR** :
    - **Code applicatif < 500 lignes** (hors `messages/*.json` i18n × 3 locales et hors tests vitest).
    - **Cap dur 800 lignes au total**. Au-delà, split obligatoire.
    - Le compteur GitHub `+X / -Y` inclut tout, donc une PR à 900 lignes dont 300 i18n + 150 tests reste OK (450 applicatif). Une PR à 700 lignes de pure logique applicative ne l'est pas — splitter en 2 issues distinctes.
11. **CI verte obligatoire avant merge — désormais APPLIQUÉE par un ruleset GitHub sur `main`** (plus seulement une discipline). Le ruleset « main protection » impose : PR obligatoire (push direct sur `main` bloqué), check `Typecheck + lint` vert, **branche à jour avec `main` avant merge** (`strict`), historique linéaire, force-push/suppression interdits. Bypass réservé au rôle **admin** (urgences). Le mode `strict` force le 2ᵉ PR à se rebaser sur le 1ᵉʳ et à re-passer le gate `check:migrations` → c'est le garde-fou contre les **collisions de numéro de migration entre PRs concurrentes** (vécues sur `0011/0014/0023/0028/0029`). Une PR cassée mergée bloquait tout le pipeline descendant — cf. incident `getOpenStatus` du 2026-05-29 (~3h de friction). NB : la *merge queue* GitHub serait l'outil idéal mais n'est **pas disponible sur un repo de compte perso** (org-only) ; `strict` en est le substitut.

## Mapping famille interne ↔ display name (legacy V1, à conserver)

| `family_slug` (DB) | Display FR            | Display EN          |
| ------------------ | --------------------- | ------------------- |
| `raquette`         | Raquette              | Racket sports       |
| `ballon`           | Ballon                | Ball sports         |
| `fitness`          | Fitness               | Fitness             |
| `combat`           | Combat                | Combat              |
| `yoga`             | Bien-être             | Wellness            |
| `baignade`         | Baignade              | Swimming            |
| `boules`           | Boules                | Boules              |
| `nautique`         | Nautique              | Nautical            |
| `glisse`           | Glisse                | Board sports        |
| `snow`             | Sport d'hiver         | Winter sports       |
| `hike`             | Plein air & endurance | Outdoor & endurance |
| `retraites`        | Retraites & camps     | Retreats & camps    |
| `plus`             | Plus de sports        | More sports         |

**Important** : `yoga` côté data = "Bien-être" côté UI (héritage V1, ne pas
renommer la clé tant que les anciennes URLs SEO ne sont pas redirigées).

## Couleurs par famille (CSS variables)

```css
--f-raquette: #2d7a3e;
--f-ballon: #b45309;
--f-fitness: #7c3aed;
--f-combat: #b91c1c;
--f-yoga: #db2777;
--f-baignade: #0891b2;
--f-boules: #ca8a04;
--f-nautique: #1e40af;
--f-glisse: #0ea5e9;
--f-snow: #6366f1;
--f-hike: #16a34a;
--f-retraites: #be185d;
--f-plus: #6b7280;
```

## Conventions DB Supabase

- **Tables singulier snake_case** : `venue`, pas `venues` ; `venue_sport`, pas `venues_sports`.
- **Toutes les tables avec data utilisateur** ont `created_at`, `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()).
- **Toute table avec slug** a un index UNIQUE sur le slug.
- **Indexes spatiaux PostGIS** sur `venue(geom)` — créés dans migration `0003`.
- **Soft delete** via `deleted_at TIMESTAMPTZ` (jamais de DELETE physique sur venue).
- **Row Level Security activée** sur toutes les tables avec data sensible (venue, claim_request).
- **Toutes les migrations DB** passent par `supabase/migrations/NNNN_*.sql` versionnées et committées. Pas d'édition ad-hoc dans le Studio.
- **Workflow migration** (depuis B mergé) :
  ```bash
  supabase migration new <nom_descriptif>     # crée supabase/migrations/NNNN_<nom>.sql
  # éditer le SQL
  ./scripts/db-push.sh                        # dry-run + confirm + push (tracke côté DB)
  git add supabase/migrations/NNNN_*.sql
  git commit + push                           # versionne dans le repo
  ```
  Le projet est linké via `supabase link --project-ref qwfvcrisfmnrfzsrnjwn`. Le CLI track les migrations appliquées côté DB → pas de divergence code/schéma. **Ne plus utiliser** `scripts/apply_migration.py` (deprecated, gardé pour fallback).
- **Gate CI migrations (#228)** : le CI exécute `node scripts/check-migrations.mjs` (= `pnpm check:migrations` en local) qui **bloque tout doublon de numéro** `NNNN_*.sql` et tout nom mal formé. C'est le garde-fou contre les collisions entre PRs concurrentes (vécues sur `0011`, `0014/0015`). **Avant de créer une migration** : `gh pr list` + vérifier le dernier numéro sur `origin/main` pour prendre le prochain libre. Les trous historiques (0002, 0008) sont tolérés (warning).
- **`CREATE INDEX CONCURRENTLY`** ne passe PAS dans une transaction `db-push` → l'exécuter à la main via le SQL Editor Supabase (cf. `supabase/migrations/0009_*` et `docs/perf-audit-*.md`).

## Conventions Next.js

- Routes data-heavy = **Server Components** avec `async` direct sur Supabase server client (`lib/supabase/server.ts`).
- Routes interactives = **Client Components** (`"use client"`), fetch via `useSWR` ou `useQuery`.
- Pas de `getServerSideProps` (App Router uniquement).
- Metadata via `export const metadata` ou `export async function generateMetadata`.
- Routes API dans `app/api/*/route.ts`, jamais `pages/api/`.

## Structure DB (vue d'ensemble)

```
country (référentiel)        sport (référentiel)         amenity (référentiel)
   │                            │                             │
   └─── city ────┐               └─── venue_sport (M:N)        └─── venue_amenity (M:N)
                 │                       │                              │
                 │                       │                              │
                 └─────────── venue ◄────┘──────────────────────────────┘
                              │
                              ├─── booking_link (1:N)
                              └─── claim_request (1:N)
```

## Ce que Claude Code NE DOIT PAS faire

- ❌ Modifier les fichiers de V1 (dans le repo `sporthub-legacy` ou `data-pipeline/`)
- ❌ Créer des migrations DB sans incrémenter le numéro (`0004_…sql` après `0003_…sql`)
- ❌ Pousser sur `main` directement — toujours via PR (désormais **bloqué techniquement** par le ruleset « main protection »)
- ❌ Ajouter des dépendances > 500 KB bundle sans justification
- ❌ Activer du cache Next.js agressif (`revalidate=3600+`) sans valider l'impact sur l'admin
- ❌ Désactiver Row Level Security pour "aller plus vite"
- ❌ Hardcoder une URL ou clé API (toujours via `process.env.*` typé dans `lib/env.ts`)
- ❌ Charger 267 000 venues d'un coup côté client — toujours paginer + bbox côté serveur
- ❌ Casser le format des URLs publiques après le go-live sans 301 dans `MIGRATION.md`

## Workflow attendu

```bash
# 1. Choisir une issue sur le board GitHub (label "ready")
gh issue list --label ready

# 2. Créer la branche dédiée
gh issue develop <num> --checkout
# ou : git checkout -b feat/<num>-<slug>

# 3. Coder le minimum pour fermer l'issue (pas plus)
#    Tester en local : pnpm dev

# 4. Commit avec Conventional Commits
git commit -m "feat(map): add cluster layer (#42)"

# 5. Push + PR
git push -u origin HEAD
gh pr create --fill --body "Closes #42"

# 6. Vercel poste auto une preview URL → la tester
# 7. Demander review à Gautier
# 8. CI "Typecheck + lint" verte + branche à jour avec main (ruleset strict).
#    Si main a bougé depuis : rebaser/mettre à jour la branche, laisser la CI
#    repasser, PUIS merger. "Squash and merge" → Vercel deploy production auto.
#    (Push direct sur main bloqué ; bypass possible seulement en rôle admin.)
```

## Objectifs MVP par phase

### Phase 1 (semaines 1-2) — Fondations

- Repo scaffold, Supabase project, Vercel branché
- Schema 0001 + 0003 (PostGIS)
- Script `import_v1.py` qui peuple ≥ 60k venues depuis SQLite V1

### Phase 2 (semaines 3-6) — Lecture parité

- `/venue/[slug]` avec metadata SEO + schema.org SportsActivityLocation
- `/map` avec MapLibre + clustering + filtres sport
- `/sports/[sport]` et `/[sport]/[country]/[city]`
- Sitemap dynamique

### Phase 3 (semaines 7-10) — Écriture & admin

- Auth Supabase (magic link + Google)
- `/admin/venues` (CRUD)
- `/venue/[slug]/claim` + `/admin/claim-requests`
- Favoris persistés (vs localStorage V1)

### Phase 4 (semaines 11-12) — Cutover

- 301 redirects de toutes les URLs V1 vers V2
- Migration finale du domaine
- Décommission Netlify V1

## Références utiles dans ce repo

- `PRODUCT_SPEC.md` — quoi & pourquoi du produit
- `DATA_MODEL.md` — détail du schéma DB et invariants
- `MIGRATION.md` — mapping URLs V1 → V2 + checklist cutover
- `ROADMAP.md` — phases & timeline
- `ADR.md` — décisions architecturales (pourquoi Supabase, pourquoi MapLibre, etc.)
