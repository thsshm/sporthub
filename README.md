# SportHub

Carte mondiale des spots sportifs. Trouve où pratiquer ton sport : tennis, padel, surf, yoga, foot, pétanque, et bien plus.

🌐 **Live** : [sporthubmap.com](https://sporthubmap.com) (V1 vanilla pour l'instant — V2 en cours)

## Stack

- **Next.js 14** (App Router) + TypeScript strict
- **Supabase** (Postgres + Auth + Storage)
- **MapLibre GL** + react-map-gl
- **Tailwind CSS** + **shadcn/ui**
- **Vercel** (hosting + preview URLs)
- **Sentry** + **PostHog**

## Prérequis

- Node.js 20+ (utiliser `nvm` recommandé)
- pnpm 9+
- Compte Supabase + Vercel + GitHub

## Lancer en local

```bash
# 1. Cloner + installer
git clone https://github.com/<you>/sporthub.git
cd sporthub
pnpm install

# 2. Configurer l'env
cp .env.example .env.local
# Remplir avec ses vraies clés Supabase / Sentry / PostHog

# 3. (Première fois) appliquer le schéma DB
supabase link --project-ref <ton-ref>
supabase db push

# 4. (Optionnel) Importer les données V1
python3 scripts/import_v1.py --mode=clubs-only --limit=1000

# 5. Dev server
pnpm dev
# → http://localhost:3000
```

## Documentation

- 📋 [`CLAUDE.md`](./CLAUDE.md) — instructions pour Claude Code
- 🎯 [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) — vision & personas
- 🗃️ [`DATA_MODEL.md`](./DATA_MODEL.md) — schéma DB détaillé
- 🛣️ [`ROADMAP.md`](./ROADMAP.md) — phases & timeline
- 🔄 [`MIGRATION.md`](./MIGRATION.md) — mapping V1 → V2
- 📐 [`ADR.md`](./ADR.md) — décisions architecturales

## Opérations (GitHub Actions)

Les jobs data longs tournent sur des runners GitHub — **plus besoin d'un Mac
allumé** (#342). Secrets requis (Repo → Settings → Secrets and variables →
Actions, déjà configurés) : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

| Workflow | Quand | Rôle |
| --- | --- | --- |
| [`cluster-clubs.yml`](./.github/workflows/cluster-clubs.yml) | manuel | Regroupe les venues en clubs (`club` + `venue.club_id`) via `scripts/cluster_clubs.py`. **Dry-run par défaut.** |
| [`regenerate-tiles.yml`](./.github/workflows/regenerate-tiles.yml) | nightly 04:00 UTC + manuel | Régénère les tuiles vectorielles PMTiles (tippecanoe) et les upload dans le bucket `tiles`. |

Déclenchement — depuis l'onglet **Actions** (bouton « Run workflow ») ou en CLI :

```bash
# Clustering : dry-run d'abord (lecture seule), puis écriture réelle
gh workflow run cluster-clubs.yml -f dry_run=true  -f family=raquette   # simulation
gh workflow run cluster-clubs.yml -f dry_run=false -f family=raquette   # écrit en DB
gh workflow run cluster-clubs.yml -f dry_run=false                      # toutes les familles

# Régénérer les tuiles à la demande (sinon nightly auto)
gh workflow run regenerate-tiles.yml

# Suivre le run
gh run watch
```

> Non migrés (hors de ce repo) : `import_v1.py` dépend de la SQLite V1 locale
> (`../data-pipeline/`), `export_clubs_js.py` et `scrape_res_raquette.py` sont
> des scripts du pipeline V1 (`sporthub-legacy`).

## Workflow

```
Issue GitHub → branch → code → commit (Conventional Commits) → PR
→ preview Vercel auto → review → squash merge → deploy prod auto
```

## Licence

Code : MIT. Données : ODbL (OpenStreetMap) + Etalab (RES France) + CC0 (Wikidata).
