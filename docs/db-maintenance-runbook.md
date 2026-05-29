# DB maintenance runbook — VACUUM, EXPLAIN, audit indexes

À lancer depuis le **SQL Editor** de Supabase Studio (`app.supabase.com/project/qwfvcrisfmnrfzsrnjwn/sql/new`) car :
- Le classifier d'accès bloque le `psql` direct depuis les agents (sécurité prod)
- `supabase db push` ne peut pas embarquer `VACUUM` (interdit dans une transaction)
- Ces queries sont des **diagnostics ponctuels**, pas des migrations versionnées

À refaire après chaque gros import ou tous les 3 mois si la table `venue` continue de grandir.

## 1. État des indexes existants sur `venue`

```sql
SELECT
  i.relname AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS size,
  idx_scan AS scans_total,
  idx_tup_read AS tuples_read
FROM pg_stat_user_indexes ui
JOIN pg_class i ON ui.indexrelid = i.oid
WHERE ui.relname = 'venue'
ORDER BY idx_scan DESC;
```

**À vérifier** :
- `idx_venue_geom_gist` (l'index spatial PostGIS) doit être en tête des scans
- Si `scans_total = 0` sur un index → il ne sert à rien, candidat à drop
- Tailles d'index : `idx_venue_geom_gist` < 200 MB sur 348k venues, sinon il y a un problème

## 2. EXPLAIN sur les 3 queries critiques

### Query bbox-aware (`venues_in_bbox`)

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, slug, name, lat, lon, family_slug, primary_sport_slug
FROM venue
WHERE is_published = TRUE
  AND deleted_at IS NULL
  AND geom && ST_MakeEnvelope(2.2, 48.8, 2.5, 49.0, 4326)::geography
LIMIT 2000;
```

**À vérifier dans la sortie** :
- `Index Scan using idx_venue_geom_gist` → ✅
- Si `Seq Scan` → ❌ l'index n'est pas utilisé (probablement stats périmées, lancer ANALYZE)
- `Execution Time` < 100 ms sur Paris
- `Buffers: shared hit=X read=Y` — si `read >> hit`, le cache Postgres est froid

### Query venue par slug (`/venue/[slug]`)

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM venue WHERE slug = 'tennis-club-paris-15' LIMIT 1;
```

**À vérifier** : `Index Scan` sur l'index UNIQUE du slug (créé en migration 0001), `Execution Time` < 5 ms.

### Query programmatic (sport × city)

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.slug, v.name, v.lat, v.lon
FROM venue v
WHERE v.is_published = TRUE
  AND v.deleted_at IS NULL
  AND v.primary_sport_slug = 'tennis'
  AND v.city_id = (SELECT id FROM city WHERE slug = 'paris' LIMIT 1)
ORDER BY v.id
LIMIT 24;
```

**À vérifier** : utilise `idx_venue_sport_city` (migration 0005). `Execution Time` < 50 ms.

## 3. VACUUM ANALYZE

Si les stats sont périmées (queries soudainement lentes ou plans bizarres) :

```sql
VACUUM ANALYZE venue;
VACUUM ANALYZE city;
VACUUM ANALYZE venue_sport;
```

⚠️ `VACUUM` peut bloquer brièvement les écritures sur les grosses tables. Sur Supabase, `autovacuum` tourne automatiquement — on n'a normalement pas besoin de le forcer. Ne le faire que si EXPLAIN révèle des `seq scan` inattendus.

## 4. Audit des dead rows

```sql
SELECT
  schemaname,
  relname,
  n_live_tup AS live_rows,
  n_dead_tup AS dead_rows,
  ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_pct
FROM pg_stat_user_tables
WHERE relname IN ('venue', 'city', 'venue_sport', 'venue_amenity')
ORDER BY n_dead_tup DESC;
```

**Si `dead_pct > 20%`** sur `venue` → lancer un `VACUUM` (pas seulement ANALYZE).

## 5. Audit RLS policy cost (lié à #101)

Les policies RLS sur `anon` causent un timeout sur les régions sparses (Atlantic, Pacific). C'est pour ça que `/api/venues` utilise `service_role` (cf. PR #146). Pour vérifier que la policy elle-même n'a pas régressé :

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM venue
WHERE is_published = TRUE AND deleted_at IS NULL
LIMIT 1;
-- (en tant que `anon` — utiliser le SQL Editor avec le rôle anon sélectionné)
```

Si le plan inclut un appel de fonction par row dans la WHERE de policy, c'est ça qui cause le timeout.

## 6. Quick win : créer un index covering si nécessaire

Si EXPLAIN sur la query bbox montre `Index Scan` + `Heap Fetches: high` → l'index ne couvre pas les colonnes select. Ajouter un index covering :

```sql
-- À mettre dans une migration NNNN_perf_covering_index.sql, pas en ad-hoc
-- CREATE INDEX idx_venue_pin_covering ON venue (geom)
-- INCLUDE (id, slug, name, lat, lon, family_slug, primary_sport_slug)
-- WHERE is_published = TRUE AND deleted_at IS NULL;
```

Trade-off : index ~50% plus gros mais 0 heap fetch sur les query map. Ne le faire que si Heap Fetches > 30% des Index Scans.

## Résultats attendus en prod (snapshot 2026-05)

| Query | Index | Time prod (anon) | Time prod (service_role) |
|---|---|---|---|
| bbox Paris (RPC) | GIST | < 50 ms | < 50 ms |
| bbox Atlantique (RPC) | GIST | **timeout** (3s) | < 80 ms |
| bbox mondiale (RPC) | GIST | **timeout** | **timeout** |
| bbox mondiale (skip ST_MakeEnvelope) | seq | n/a | < 200 ms |
| /venue/[slug] | unique slug | < 5 ms | < 5 ms |
| /sport/[country]/[city] | composite | < 50 ms | < 50 ms |

Les timeouts anon sont gérés par `service_role` dans `/api/venues` (cf. PR #146 fix #101). Les timeouts world bbox sont gérés par le skip ST_MakeEnvelope dans le kind=`global`.
