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

## Workflow

```
Issue GitHub → branch → code → commit (Conventional Commits) → PR
→ preview Vercel auto → review → squash merge → deploy prod auto
```

## Licence

Code : MIT. Données : ODbL (OpenStreetMap) + Etalab (RES France) + CC0 (Wikidata).
