# ADR #227 — ETL V2-natif : couper le cordon SQLite V1

**Statut** : implémentation en cours (Phase 1.B de ROADMAP-SCALE.md)
**Date** : 2026-06-07

## Contexte

La source de vérité des ~370k venues est un SQLite V1 (`sportpin.sqlite`) importé manuellement depuis `data-pipeline/`. V2 n'a pas d'ingestion native — les données arrivent par `import_v1.py` + `db-push` manuels. Le refresh cron ne couvre que Wikidata, diving, hyrox, paragliding (sources mineures).

Conséquences :
- Fraîcheur non maîtrisée (le SQLite peut prendre du retard).
- Familles `snow` et `retraites` à 0 venue (#97) faute de pipeline V2.
- Dépendance à une machine locale pour tout re-import.

## Décision

On construit un **ETL V2-natif** qui lit OSM (Overpass) et Overture directement, upsert par `(source, external_id)` idempotent dans Postgres, et orchestre via **GitHub Actions** (workers déjà câblés par #342, secrets `SUPABASE_*` configurés).

## Architecture

```
Sources                Ingestion (idempotent)             Postgres
─────────              ──────────────────────             ─────────
OSM Overpass  ─┐       scripts/etl/osm_import.py  ──────► venue
Overture      ─┼──►   ON CONFLICT (source,               (source, external_id) UNIQUE
RES           ─┘       external_id) DO UPDATE            import_run (traçabilité)
```

- **Gros imports** (monde, Overture parquet) → GitHub Actions (6h max).
- **Refresh incrémental léger** (FR/EU, par bbox/tag) → Vercel cron.
- **Upsert par `(source, external_id)`** : clé UNIQUE (migration 0043).
- **Soft-delete des disparus** : `deleted_at` sur ce qui n'est plus dans la source.

## Découpage en sous-issues (1 PR = 1 issue)

| Slice | Livrable | PR |
|---|---|---|
| **227.1** (cette PR) | Socle : migration `import_run` + UNIQUE `(source, external_id)` + `etl_upsert.py` (helpers + self-test) | #xxx |
| **227.2** | Importeur OSM Overpass, 1 famille / 1 région (tennis FR) + workflow GH Actions | TBD |
| **227.3** | Réconciliation soft-delete + `import_run` reporting | TBD |
| **227.4** | Toutes familles FR/EU (mapping tags OSM → `family_slug`/`sport_slug`) | TBD |
| **227.5** | Importeur Overture (parquet + DuckDB) monde par région | TBD |
| **227.6** | Dédup cross-source (géo 50m + nom normalisé) + précédence | TBD |
| **227.7** | Cutover + `import_v1.py` deprecated (recoupe #343) | TBD |

## Décisions ouvertes (input de Gautier attendu)

| # | Question | Défaut si pas de réponse |
|---|---|---|
| D1 | **Hôte worker** : GitHub Actions (gratuit, simple) vs worker dédié (Fly/Railway si jobs > 6h) ? | GitHub Actions (déjà câblé) |
| D2 | **Mode OSM** : Overpass API (incrémental, simple) vs planet PBF (bulk monde, lourd) ? | Overpass pour 227.2 |
| D3 | **Périmètre initial** : parité FR/EU (remplacer V1 sans régression) PUIS monde, ou monde direct ? | FR/EU d'abord |
| D4 | **Précédence de dédup** : en conflit géo+nom entre sources, qui gagne (OSM / Overture / RES) ? | À définir en 227.6 |

## Risques

- **Volume monde (10M+)** : par région, idempotent — pas en une passe.
- **Rate-limit Overpass** : OK incrémental, pas bulk monde → Overture/planet pour le bulk.
- **Mapping tags OSM** : le gros du boulot (OSM `sport=*`/`leisure=*` → 14 familles) — qualité critique.
- **Reverse geocode** (`city_id`/`country_code` monde) : partiel aujourd'hui.
