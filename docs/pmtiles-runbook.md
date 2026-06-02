# Runbook — Tuiles vectorielles PMTiles (#226)

> Découple le rendu carte de Postgres. Au lieu de fetcher des points via
> `/api/venues` à chaque pan/zoom (coût O(volume), plafonne ~10-50k pts/viewport),
> la carte rend les venues depuis des **tuiles vectorielles pré-rendues** — coût
> **O(1)** quel que soit le total. C'est le déblocage clé du passage au mondial
> (cf. `ROADMAP-SCALE.md`, phase 1.A).

## Architecture (livrée)

```
 Postgres ──(1)──► venues.geojsonl ──(2)──► venues.pmtiles ──(3)──► Supabase Storage (bucket public 'tiles') + CDN
                                                                              │
                                                                       (4) pmtiles://<url>
                                                                              ▼
                                                                       MapLibre (VenueTilesLayer)
```

| # | Étape | Implémentation | PR |
|---|-------|----------------|----|
| 1-2 | Export Postgres → GeoJSONL → `.pmtiles` (tippecanoe) | `scripts/generate_venue_tiles.py` | #243 |
| 3 | Upload → Supabase Storage (bucket public `tiles`, upsert) | `scripts/upload_venue_tiles.py` | #284 |
| 4 | Rendu MapLibre via `pmtiles://`, **gated** par `NEXT_PUBLIC_TILES_URL` | `app/[locale]/map/VenueTilesLayer.tsx`, `lib/map/venue-tiles.ts` | #290 |
| — | Régénération nightly (cron) | `.github/workflows/regenerate-tiles.yml` | #314 |

Le gating côté carte (`MapClient.tsx`) :

```ts
const useTiles = Boolean(publicEnv.tilesUrl) && !presetVenues;
```

→ **tant que `NEXT_PUBLIC_TILES_URL` est vide, la carte garde son comportement
actuel** (`/api/venues` + Supercluster). La bascule est donc un simple toggle
d'env var, réversible.

## Activation (3 étapes ops)

### 1. Secrets GitHub Actions

Repo → **Settings → Secrets and variables → Actions → New repository secret** :

| Secret | Valeur |
|--------|--------|
| `SUPABASE_URL` | `https://qwfvcrisfmnrfzsrnjwn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role key (lecture venues + upload Storage) |

### 2. Première génération

**Actions → _Regenerate venue tiles_ → Run workflow** (branche `main`).

Le job (ubuntu, ~5-15 min selon le volume) :
- builde tippecanoe (épinglé `2.79.0`, mis en cache pour les runs suivants) ;
- exporte les venues publiées → GeoJSONL → `venues.pmtiles` ;
- upload (upsert) dans le bucket public `tiles`.

Le `.pmtiles` est alors servi à une **URL stable** :

```
https://qwfvcrisfmnrfzsrnjwn.supabase.co/storage/v1/object/public/tiles/venues.pmtiles
```

> Vérifier dans le _step summary_ du run que `venues.pmtiles` a bien été généré
> (taille affichée). En local on peut aussi lancer manuellement :
> `python3 scripts/generate_venue_tiles.py && python3 scripts/upload_venue_tiles.py`
> (nécessite `brew install tippecanoe` + les creds Supabase en `.env.local`).

### 3. Bascule du rendu carte

Vercel → **Settings → Environment Variables** :

| Variable | Valeur | Scope |
|----------|--------|-------|
| `NEXT_PUBLIC_TILES_URL` | l'URL publique du `.pmtiles` (étape 2) | Production (+ Preview pour tester) |

Puis **redéployer** (les `NEXT_PUBLIC_*` sont inlinées au build → un redeploy est
nécessaire). À partir de là `/map` rend les venues depuis les tuiles.

### Vérification

- `/map` : les pins s'affichent fluides à tout zoom, même dézoomé sur le monde,
  sans rafale de requêtes `/api/venues` (DevTools → Network : plus de fetch de
  pins au pan ; `/api/venues` ne sert plus que la **liste + recherche**).
- La couche tuiles colore par famille et ajuste le rayon par zoom
  (`lib/map/venue-tiles.ts`).

### Rollback

Vider `NEXT_PUBLIC_TILES_URL` (ou la supprimer) + redéployer → retour immédiat au
rendu `/api/venues` + Supercluster. Aucune migration DB impliquée.

## Régénération

- **Automatique** : le workflow tourne chaque nuit (cron `0 4 * * *` UTC).
  L'URL du `.pmtiles` étant stable, rien à changer côté Vercel — le CDN sert la
  nouvelle version au prochain cache-miss.
- **À la demande** : _Run workflow_ manuel (ex. après un gros import Overture).

## Notes

- **Pourquoi GitHub Actions et pas un cron Vercel** : la génération passe par
  `tippecanoe` (binaire C++), impossible à exécuter dans une fonction serverless
  Vercel. Un runner GH le builde et exécute le job lourd.
- **Pas de précache des 347k venues côté SW** : hors-scope (cf. note #249 PWA).
- Le `.pmtiles` est un artefact (jamais commité) — régénéré, pas versionné.
