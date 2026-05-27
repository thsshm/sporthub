# SportHub V2 — Roadmap

> 4 phases, 11-12 semaines pour la parité V1 + extensions Phase 3.
> Si glissement, on regarde la doc V1 dans `sporthub-legacy/` et on prend des raccourcis (réutiliser scripts Python existants par exemple).

## Phase 1 — Fondations (semaines 1-2)

**Objectif** : repo opérationnel, Supabase peuplée, déploiement Vercel.

| # | Tâche | Acceptance |
|---|---|---|
| 1.1 | Scaffold Next.js 14 + TS + Tailwind + shadcn | `pnpm dev` lance le site sur localhost |
| 1.2 | Projet Supabase créé (region Paris) + env vars Vercel | Connection client→Supabase OK |
| 1.3 | Migration 0001 (tables initiales) | `SELECT count(*) FROM sport` retourne ≥ 50 |
| 1.4 | Migration 0003 (PostGIS) | Index spatial créé, requêtes ST_DWithin fonctionnent |
| 1.5 | Script `import_v1.py --mode=clubs-only --limit=1000` | 1000 venues en DB avec sports + amenities |
| 1.6 | Import full V1 (60k+ venues) | `SELECT count(*) FROM venue` ≥ 60k |
| 1.7 | Sentry + PostHog branchés | Une erreur test apparaît dans Sentry |

**Livrable** : Site déployé sur `app.sporthubmap.com` qui affiche "Hello World" avec count de venues réel depuis Supabase.

## Phase 2 — Lecture parité (semaines 3-6)

**Objectif** : V2 peut remplacer V1 pour 80 % des visites read-only.

### Semaine 3 — Routes statiques
- `/` (landing avec hero + cartes famille)
- `/venue/[slug]` avec metadata SEO + schema.org SportsActivityLocation
- Layout : Nav + Footer

### Semaine 4 — Carte interactive
- `/map` avec MapLibre + clustering
- Filtres sport (sidebar gauche)
- Popup au clic sur pin

### Semaine 5 — Pages programmatiques
- `/sports/[sport]` (page sport global)
- `/[sport]/[country]/[city]` (équivalent `padel-paris.html` V1)
- Sitemap dynamique
- Recherche ville (Nominatim)

### Semaine 6 — Polish
- Mobile-first checks
- Performance Lighthouse > 90
- OG images dédiées par famille (réutiliser ceux V1)
- hreflang FR/EN/ZH

**Livrable** : Audit SEO comparatif V1 vs V2 → V2 ≥ V1 sur 80 % des critères.

## Phase 3 — Écriture & admin (semaines 7-10)

**Objectif** : Fonctionnalités impossibles en V1 (claims, admin, comptes user).

### Semaine 7 — Auth
- Supabase Auth magic link + Google OAuth
- Page `/login`, gestion session côté Next.js

### Semaine 8 — Admin
- Layout `/admin/*` protégé (check role admin via JWT claim)
- `/admin/venues` table + édition
- `/admin/sports`, `/admin/amenities` (CRUD référentiels)

### Semaine 9 — Claims
- Formulaire `/venue/[slug]/claim`
- Upload proof via Supabase Storage
- `/admin/claim-requests` (review queue)
- Email notif sur claim approval

### Semaine 10 — Favoris cross-device
- Migration favoris localStorage → Supabase pour utilisateurs connectés
- Page `/favoris` avec sync DB

**Livrable** : 1 club test qui claim sa fiche et édite ses infos en autonomie.

## Phase 4 — Cutover (semaines 11-12)

**Objectif** : Production V2 = sporthubmap.com.

### Semaine 11 — Prep
- Mapping 301 V1 → V2 dans `MIGRATION.md` (toutes les URLs publiques)
- Configuration redirects Netlify (V1) pointant vers Vercel (V2) — préserve juice SEO
- Submission sitemap V2 à Google Search Console
- Tests E2E sur les 20 pages les plus visitées

### Semaine 12 — Bascule
- DNS sporthubmap.com → Vercel (au lieu de Netlify)
- V1 archivée en lecture seule sur netlify (URL `legacy.sporthubmap.com`)
- Monitoring intensif des Core Web Vitals + erreurs Sentry
- Communication (si audience) : changelog blog post

**Livrable** : sporthubmap.com servit par V2. V1 archivée. Tous les anciens liens externes 301-redirigent vers V2.

## Hors-roadmap (futurs)

| Feature | Phase potentielle |
|---|---|
| Table `installation` (granularité court individuel) | Phase 5+ |
| Réservation directe in-app | Pas dans le scope (partenaires le font) |
| Reviews utilisateurs | Phase 5+ |
| Galerie photos multi par venue | Phase 5+ |
| Conditions live (vent/houle/neige) | Phase 6+ |
| App mobile native | Phase 7+ (à valider avec data : taux utilisation mobile web) |
| API publique B2B | Phase 6+ |

## Métriques de pilotage

À mettre à jour chaque semaine dans ce document :

| Semaine | Phase | % done | Bloquages | Décisions |
|---|---|---:|---|---|
| 1 | 1 | — | — | — |
| 2 | 1 | — | — | — |

## Principes de priorisation

1. **Si une feature peut attendre, elle attend.** On livre le minimum pour passer à l'étape suivante.
2. **Si une décision peut être reportée, on la reporte.** Ex : choix booking partner Phase 3 plutôt que Phase 1.
3. **Si un raccourci est honnête, on le prend.** Réutiliser un script V1 plutôt que tout réécrire, c'est OK.
4. **Si on traîne sur une phase**, on coupe le scope (skip features non critiques) plutôt que glisser le timeline.
