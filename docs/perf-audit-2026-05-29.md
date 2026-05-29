# Perf audit DB carte — 2026-05-29

> Runbook lié à l'issue **#115** — *perf(map): VACUUM ANALYZE + EXPLAIN + audit
> index spatial GIST*. Toutes les commandes ci-dessous se lancent
> manuellement dans le **SQL Editor de Supabase** (Dashboard → SQL Editor →
> New query). Aucune ne peut tourner via la CI ou `supabase db push`.

## Préambule

Sprint 1 quick wins perf carte (phase 2). On a importé V1 → 348 k venues dans
`venue` sans relancer `VACUUM ANALYZE`. Les stats du planner ne reflètent donc
plus la distribution réelle des lignes, ce qui peut générer des `Seq Scan` sur
les bbox queries — symptôme remonté en #81 / #102 (timeout statement sur Paris).

L'audit a trois objectifs, indépendants l'un de l'autre :

1. **Forcer les stats à jour** (`VACUUM ANALYZE venue`).
2. **Confirmer que l'index GIST `idx_venue_geom`** (migration `0003_postgis.sql`)
   est bien utilisé pour les bbox queries, sur trois zones de tailles différentes.
3. **Déployer un index partiel** `idx_venue_geom_published` (migration
   `0009_index_partial_published.sql`) qui colle exactement aux prédicats
   `is_published = true AND deleted_at IS NULL` utilisés par 99 % des appels
   `/api/venues`.

Aucun code applicatif n'est touché par cette issue — pure couche DB.

---

## 1. VACUUM ANALYZE (à lancer en premier)

```sql
VACUUM ANALYZE venue;
```

- **Durée attendue** : 30 s à 2 min sur 348 k rows.
- **Bloquant ?** Non — `VACUUM` (sans `FULL`) est non-bloquant en lecture/écriture.
- **À refaire** : oui, à chaque import massif (≥ 10 % de variation de volume).

Vérifier l'effet :

```sql
SELECT
  relname,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  n_live_tup,
  n_dead_tup
FROM pg_stat_user_tables
WHERE relname = 'venue';
```

**Attendu** : `last_analyze` dans les dernières minutes après run.

---

## 2. EXPLAIN ANALYZE sur 3 bbox

Lancer les trois requêtes ci-dessous **dans l'ordre** et coller chaque plan
dans le commentaire de l'issue #115 (traçabilité).

### 2.a Paris dense

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, name, lat, lon, family_slug
FROM venue
WHERE geom && ST_MakeEnvelope(2.20, 48.78, 2.55, 48.95, 4326)::geography
  AND is_published = true
  AND deleted_at IS NULL
LIMIT 500;
```

**Attendu** : `Bitmap Index Scan on idx_venue_geom_published` (ou
`idx_venue_geom` si le partial n'est pas encore créé) puis `Bitmap Heap Scan`.
**< 50 ms** côté Postgres hors latence réseau.

### 2.b Lyon (zone moyenne)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, name, lat, lon, family_slug
FROM venue
WHERE geom && ST_MakeEnvelope(4.75, 45.70, 4.92, 45.81, 4326)::geography
  AND is_published = true
  AND deleted_at IS NULL
LIMIT 500;
```

**Attendu** : même plan qu'à Paris, latence proportionnelle au nombre de hits.

### 2.c France entière

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, name, lat, lon, family_slug
FROM venue
WHERE geom && ST_MakeEnvelope(-5, 42, 9, 51, 4326)::geography
  AND is_published = true
  AND deleted_at IS NULL
LIMIT 500;
```

**Attendu** : index encore utilisé (peut basculer en `Bitmap Index Scan` pur,
pas grave), pas de `Seq Scan`. Latence plus élevée car volume.

---

## 3. Vérification des index existants

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'venue'
ORDER BY indexname;
```

**Attendu** au minimum (après application de la migration `0009`) :

| indexname                       | source              |
|---------------------------------|---------------------|
| `idx_venue_geom`                | `0003_postgis.sql`  |
| `idx_venue_geom_published`      | `0009_*.sql` (nouveau) |
| `idx_venue_primary_sport`       | `0005_perf_indexes.sql` |
| `idx_venue_sport_city`          | `0005_perf_indexes.sql` |
| `idx_venue_updated_at_desc`     | `0005_perf_indexes.sql` |
| `venue_pkey`                    | `0001_initial_schema.sql` |
| `venue_slug_key`                | `0001_initial_schema.sql` |

Variante : `\d venue` dans psql.

---

## 4. Vérification du type de la colonne `geom`

```sql
SELECT pg_typeof(geom) AS type FROM venue WHERE geom IS NOT NULL LIMIT 1;
```

**Attendu** : `geography`. Si `geometry`, c'est une régression — l'index GIST
sur `geometry` ne sera pas utilisé par les requêtes en `::geography`. Voir
section 7 (remédiation).

---

## 5. Vérification du trigger `trg_venue_geom`

```sql
SELECT tgname, tgenabled, tgtype
FROM pg_trigger
WHERE tgname = 'trg_venue_geom';
```

**Attendu** : 1 ligne, `tgenabled = 'O'` (enabled origin).

### Test d'idempotence (insert / soft-delete)

```sql
-- 1. INSERT venue test : geom doit être renseigné par le trigger
INSERT INTO venue (slug, name, lat, lon, family_slug, primary_sport_slug, is_published)
VALUES ('audit-115-test', 'Audit 115 test', 48.8566, 2.3522, 'raquette', 'tennis', true)
RETURNING id, geom IS NOT NULL AS geom_set;
-- Attendu : geom_set = true

-- 2. Le partial index doit la voir
SELECT id, name
FROM venue
WHERE geom && ST_MakeEnvelope(2.20, 48.78, 2.55, 48.95, 4326)::geography
  AND is_published = true
  AND deleted_at IS NULL
  AND slug = 'audit-115-test';
-- Attendu : 1 ligne

-- 3. Soft-delete : le partial index ne doit plus la lister
UPDATE venue SET deleted_at = NOW() WHERE slug = 'audit-115-test';

SELECT id, name
FROM venue
WHERE geom && ST_MakeEnvelope(2.20, 48.78, 2.55, 48.95, 4326)::geography
  AND is_published = true
  AND deleted_at IS NULL
  AND slug = 'audit-115-test';
-- Attendu : 0 ligne

-- 4. Cleanup
DELETE FROM venue WHERE slug = 'audit-115-test';
```

---

## 6. Vérification d'usage (`pg_stat_user_indexes`)

À lancer **après quelques appels `/api/venues`** (ouvrir la carte, naviguer
Paris → Lyon → France, au moins 5-10 appels).

```sql
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname IN ('idx_venue_geom', 'idx_venue_geom_published');
```

**Attendu** :

- `idx_venue_geom_published.idx_scan` > 0 (preuve que le planner l'utilise).
- `idx_venue_geom.idx_scan` peut rester à 0 si toutes les requêtes ont les deux
  prédicats — c'est attendu et confirme que le partial est plus sélectif.

---

## 7. Interprétation & remédiation

### Lecture des plans EXPLAIN

| Plan                                    | Verdict          |
|-----------------------------------------|------------------|
| `Bitmap Index Scan on idx_venue_geom_published` | ✅ idéal  |
| `Bitmap Index Scan on idx_venue_geom`           | ✅ correct, partial pas encore créé / trop large |
| `Index Scan` (sur n'importe quel index spatial) | ✅ ok pour petite bbox |
| `Seq Scan on venue`                              | ❌ jamais acceptable, remédier |

### Si `Seq Scan` apparaît malgré l'index

1. **Vérifier le type de `geom`** (section 4). Si `geometry`, la requête en
   `::geography` ne touchera pas l'index. Conversion :

   ```sql
   ALTER TABLE venue ALTER COLUMN geom TYPE geography(POINT, 4326) USING geom::geography;
   REINDEX INDEX CONCURRENTLY idx_venue_geom;
   REINDEX INDEX CONCURRENTLY idx_venue_geom_published;
   ```

2. **Vérifier l'opérateur** : `geom && bbox` (le bbox overlap) est indexable
   par GIST. `ST_DWithin` l'est aussi mais peut basculer en Seq Scan si la
   cardinalité estimée est très haute. Si la requête utilise un autre
   opérateur, le planner peut décrocher.

3. **Cardinalité estimée** : si Postgres pense matcher > 25-30 % des lignes,
   il préfère un Seq Scan. C'est rationnel. Restreindre le LIMIT ou la bbox
   résout en général.

4. **Pooler Supabase (PgBouncer)** : en mode `transaction`, le pooler tronque
   `statement_timeout`. Si la query timeout côté API mais que `EXPLAIN ANALYZE`
   passe dans le SQL Editor, c'est ce problème → vérifier `pool_mode` dans
   Project Settings → Database.

---

## 8. Comment lancer la migration `0009_index_partial_published.sql`

⚠️ **Ne PAS utiliser `supabase db push`** pour cette migration : la CLI
enveloppe chaque fichier dans une transaction implicite, ce qui interdit
`CREATE INDEX CONCURRENTLY`. Procédure manuelle :

1. Ouvrir Supabase Dashboard → **SQL Editor** → **New query**.
2. Coller le contenu de
   `supabase/migrations/0009_index_partial_published.sql`.
3. **Run**. Durée attendue : ~1-5 min sur 348 k rows (le `CONCURRENTLY`
   double le temps mais évite tout lock en écriture).
4. Vérifier que l'index est créé et `VALID` :

   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE indexname = 'idx_venue_geom_published';

   SELECT indexrelid::regclass, indisvalid, indisready
   FROM pg_index
   WHERE indexrelid = 'idx_venue_geom_published'::regclass;
   ```

   `indisvalid = true` et `indisready = true` → OK. Si `indisvalid = false`,
   le `CREATE INDEX CONCURRENTLY` a échoué silencieusement, droper et relancer :

   ```sql
   DROP INDEX CONCURRENTLY idx_venue_geom_published;
   -- Puis re-coller la migration et relancer.
   ```

5. Le fichier reste committé pour traçabilité et pour rejouer la migration
   telle quelle sur un environnement neuf (dev / preview). Sur prod, comme
   l'index existe déjà, le `IF NOT EXISTS` rend l'opération idempotente.

---

## 9. Checklist de clôture issue #115

À cocher dans le commentaire de fermeture :

- [ ] `VACUUM ANALYZE venue` lancé, `last_analyze` confirmé < 1h.
- [ ] EXPLAIN Paris collé dans l'issue (plan utilise un index spatial,
      pas de Seq Scan).
- [ ] EXPLAIN Lyon collé dans l'issue.
- [ ] EXPLAIN France entière collé dans l'issue.
- [ ] `idx_venue_geom_published` créé et `indisvalid = true`.
- [ ] Test idempotence (insert + soft-delete) OK.
- [ ] `pg_stat_user_indexes.idx_scan > 0` sur le partial après navigation
      réelle de la carte.
- [ ] Pas de timeout sur `GET /api/venues?bbox=2.20,48.78,2.55,48.95&limit=500`.
