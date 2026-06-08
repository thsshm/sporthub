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

# 4. (Données) — ETL V2-natif, plus de SQLite V1 (#227)
#    Les venues sont peuplées par les workflows GitHub Actions :
#    gh workflow run osm-import.yml      -f apply=true
#    gh workflow run overture-import.yml -f apply=true
#    (scripts/import_v1.py est DEPRECATED — cutover #227, ne plus l'exécuter)

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
| [`osm-import.yml`](./.github/workflows/osm-import.yml) | dim. 02:00 UTC + manuel | Ingestion V2-native depuis OSM (Overpass) via `scripts/etl/osm_import.py`. **Dry-run par défaut** (`-f apply=true` pour écrire). Source de vérité #227. |
| [`overture-import.yml`](./.github/workflows/overture-import.yml) | dim. 03:00 UTC + manuel | Ingestion V2-native depuis Overture (DuckDB/S3) via `scripts/etl/overture_import.py`. **Dry-run par défaut.** Source de vérité #227. |
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

> **DEPRECATED (cutover #227, 2026-06-08)** : `import_v1.py`,
> `import_enrichments_v1.py` et `backfill_family_null_sport.py` dépendent de la
> SQLite V1 locale (`../data-pipeline/`) et **ne doivent plus être exécutés** —
> les données sont 100% V2-natives (OSM/Overture/RES). `export_clubs_js.py` et
> `scrape_res_raquette.py` restent des scripts du pipeline V1 (`sporthub-legacy`).

## Workflow

```
Issue GitHub → branch → code → commit (Conventional Commits) → PR
→ preview Vercel auto → review → squash merge → deploy prod auto
```

## Licence

Code : MIT. Données : ODbL (OpenStreetMap) + Etalab (RES France) + CC0 (Wikidata).
