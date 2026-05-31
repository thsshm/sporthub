# SportHub V2 — Roadmap scalabilité

> Roadmap technique dérivée du challenge architecture (mai 2026). Complète
> `ROADMAP.md` (qui couvre les phases produit 1→4). Ce document se concentre sur
> **la tenue à l'échelle** : passer d'un annuaire France/Europe (~350k venues) à
> un annuaire réellement mondial (10M+ POI OSM/Overture).
>
> Principe directeur : **découpler le rendu carte de Postgres**, **rendre la
> lecture publique sûre**, **posséder l'ingestion de données**.

## État de départ (mai 2026)

- Stack : Next.js 14 (App Router) + Supabase (Postgres + PostGIS) + MapLibre + Vercel
- ~348k venues, source de vérité = SQLite V1 importé manuellement
- Data-path carte : GeoJSON over HTTP + Supercluster client + agrégats serveur `ST_SnapToGrid`
- `/api/venues` : Edge runtime, **bypass RLS via service_role** (contournement d'un `statement_timeout`)
- Migrations manuelles (`db-push`), types régénérés à la main
- Phase 2 produit quasi bouclée (parité V1 ~atteinte)

---

## Phase 0 — Stabiliser (1-2 semaines) · *avant toute nouvelle feature*

**Objectif** : solder la dette ouverte + fermer le trou de sécurité, sans rien construire de neuf.

| # | Tâche | Pourquoi | Sortie |
|---|---|---|---|
| 0.1 | Drainer la merge queue (PRs #179/#181/#194/#221…) | Réduire la surface de conflits | 0 PR > 3 jours |
| 0.2 | Appliquer migrations en attente + `cluster_clubs.py` prod | Cohérence prod ↔ code | `migration list` local == remote |
| 0.3 | **Rendre la query anon-RLS rapide** (EXPLAIN, valider GIST partiel `0009`) | Pré-requis pour 0.4 | Paris bbox < 50ms côté PG, `Bitmap Index Scan` |
| 0.4 | **Retirer `service_role` du chemin public `/api/venues`** | Fermer le trou de sécu (god-mode dans Edge) | Lecture publique en clé anon, RLS effective |
| 0.5 | Gate CI migrations + auto-apply au deploy + types regen en CI | Fin du `db-push` manuel + chicken-and-egg types | Pipeline reproductible |

**Critère de sortie de phase** : aucune clé service_role sur un chemin public, ops migrations automatisées, board < 5 PRs.

---

## Phase 1 — Fondations d'échelle (4-6 semaines) · *le move structurant*

**Objectif** : le data-path carte ne doit plus dépendre du nombre total de venues.

### 1.A — Vector tiles (PMTiles) — **priorité absolue**
Le rendu carte passe de "GeoJSON + Supercluster client" à des **tuiles vectorielles pré-rendues**.

- Générer un `.pmtiles` depuis Postgres (tippecanoe ou `pg_tileserv` → export) par famille ou global
- Héberger sur object storage (Supabase Storage / S3 / R2) + CDN
- MapLibre lit les tuiles directement (`pmtiles://`) — **coût O(1) quel que soit le total**
- Pipeline de régénération des tuiles (nightly ou sur changement data)
- Garder `/api/venues` uniquement pour la **liste/recherche** (pas le rendu des pins)

**Sortie** : carte fluide à n'importe quel zoom, indépendante du volume Postgres. Débloque le mondial.

### 1.B — Posséder l'ingestion (ETL V2-natif)
Couper le cordon avec le SQLite V1.

- Pipeline V2 qui lit **OSM (Overpass/planet) + Overture** directement
- Upsert idempotent par `external_id` dans Postgres (pattern déjà en place côté cron)
- Orchestration : Vercel cron (léger) ou worker dédié (gros imports)
- `source` + `external_id` comme clés de traçabilité (déjà au schéma)

**Sortie** : fraîcheur des données maîtrisée, ré-import sans downtime, plus de dépendance V1.

### 1.C — Clustering correct
- Remplacer `ST_SnapToGrid` (degrés, artefacts haute latitude) par **H3** si l'extension devient dispo, sinon grille **équi-surface** (projection web-mercator avant snap)

**Critère de sortie de phase** : 1M+ venues affichables sans dégradation carte ; ingestion V2 autonome.

---

## Phase 2 — Mondial (8-12 semaines)

**Objectif** : couvrir le monde, tenir la charge.

| Axe | Tâche |
|---|---|
| Données | Import Overture/OSM monde (par région, idempotent) — viser 5-10M venues |
| Perf DB | Read replica(s) Supabase / cache applicatif (Redis) devant les agrégats ; partitionnement `venue` par `country_code` si besoin |
| SEO | Sitemap mondial : génération incrémentale + priorisation crawl budget (pas tout d'un coup) |
| Reverse geocode | `city_id` / `country_code` fiables à l'échelle monde (actuellement partiel) |
| i18n | Au-delà de FR/EN/ZH si marchés ciblés ; hreflang déjà en place |
| Coût | Monitorer coût Postgres/egress ; les tuiles CDN absorbent l'essentiel |

**Critère de sortie** : produit mondial servi sous SLA, coût linéaire maîtrisé.

---

## Chantiers transverses (continus)

- **Sécurité** : RLS effective partout, jamais de service_role exposé côté public/Edge ; audit clés
- **Edge footgun** : lint/CI qui interdit `getSupabaseAdminClient` (ssr → `next/headers`) dans une route `runtime="edge"`
- **Observabilité** : Sentry + PostHog branchés (DSN à poser) ; alerting sur timeouts PG, erreurs cron
- **Données enrichments** : si filtrage/tri sur `enrichments` JSONB devient nécessaire → promouvoir en colonnes typées + index
- **Ops migrations** : numérotation + CONCURRENTLY hors-transaction documentés (cf. `docs/perf-audit-*.md`)

---

## Anti-objectifs (à ne PAS faire trop tôt)
- Microservices / découpage prématuré — Postgres + Next monolithe suffit longtemps
- Recherche full-text avancée (Elastic) avant d'avoir le besoin produit
- Multi-région DB avant que la charge le justifie

---

## Séquencement résumé

```
Phase 0 (stabiliser + sécu)   ──┐
                                ├─► Phase 1 (vector tiles + ETL) ──► Phase 2 (mondial)
chantiers transverses ─────────┘        ▲
                                        └ le vector tiles (1.A) est le déblocage clé
```

> Le seul move qui change la trajectoire produit, c'est **1.A (vector tiles)**.
> Tout le reste est de l'hygiène (importante) ou de la suite logique.
