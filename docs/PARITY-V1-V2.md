# Audit parité V1 → V2 — snapshot

> **Snapshot généré le 2026-05-29** — la source de vérité reste l'issue [#129](https://github.com/thsshm/sporthub/issues/129) sur GitHub.
>
> Ce document fige l'état de l'audit à date, croisé avec les PRs récemment mergées ou en review. Il n'a pas vocation à remplacer l'issue, juste à donner une vue versionnée et navigable en local.

## Légende

- ✅ **Fait** — fonctionnel en V2 (issue fermée + PR mergée)
- 🟡 **En cours** — issue ouverte ou PR en review (lien vers l'issue / PR)
- ❌ **Manquant** — pas trackée, à créer ou décider qu'on s'en passe
- ⚪ **N/A** — concept V1 sans équivalent V2 nécessaire (changement d'archi)

## Résumé exécutif (mis à jour 2026-05-29)

| Zone | ✅ | 🟡 | ❌ | Total |
|---|---|---|---|---|
| Carte interactive | 6 | 1 | 3 | 10 |
| Popup pin | 8 | 0 | 3 | 11 |
| Vue club | 0 | 1 | 5 | 6 |
| Filtres sidebar | 6 | 0 | 2 | 8 |
| Liste side-by-side | 1 | 3 | 2 | 6 |
| Landing page | 9 | 1 | 1 | 11 |
| Navigation | 5 | 1 | 0 | 6 |
| Pages famille | 1 | 0 | 0 | 1 |
| Pages spécialisées | 0 | 0 | 5 | 5 |
| Pages programmatiques | 3 | 0 | 0 | 3 |
| Favoris | 3 | 3 | 2 | 8 |
| Géolocalisation | 7 | 0 | 1 | 8 |
| Recherche | 3 | 0 | 1 | 4 |
| Explore page | 1 | 2 | 3 | 6 |
| Villes page | 0 | 0 | 5 | 5 |
| Mobile responsive | 5 | 0 | 3 | 8 |
| i18n FR/EN/ZH | 7 | 2 | 0 | 9 |
| SEO / metadata | 8 | 2 | 2 | 12 |
| Robots / Manifest IA | 1 | 1 | 2 | 4 |
| Empty states / Loading | 6 | 0 | 1 | 7 |
| Accessibility | 5 | 0 | 2 | 7 |
| Retraites overlay | 0 | 1 | 5 | 6 |
| Analytics / Monitoring | 1 | 1 | 2 | 4 |
| **Total** | **86** | **19** | **50** | **155** |

**Parité actuelle : 55% fait + 12% en cours = 67% — 32% à créer (50 manques détectés).**

> Note : le total atteint 155 items (vs 154 dans le snapshot du 2026-05-28) car la zone SEO contenait 12 items détaillés mais 11 dans le tableau récap amont (off-by-one typo recompté ici à 12). Les comptes par zone ci-dessous reflètent la liste exhaustive.

Δ depuis le snapshot du 2026-05-28 : **+19 items ✅** (16 promotions 🟡→✅ + 2 promotions ❌→✅ + 1 reclassement), **−15 items 🟡** consommés par PRs mergées (compensés par 3 nouvelles ❌→🟡), **−4 items ❌** rattrapés. Détail dans la section [Δ depuis le dernier audit](#-depuis-le-dernier-audit).

## Manques critiques (top 10 à considérer)

Ces 10 trous V1→V2 ne sont **pas trackés** sur le board et méritent décision rapide :

1. ❌ **Vue club V1** (1 pin = 1 établissement avec installations internes au lieu de N pins par court) — gros impact UX raquette/fitness/yoga — issue ouverte #130
2. ❌ **Page `/explore` unifiée** (carte multi-disciplines avec picker initial) — issue ouverte #132 (fusionner dans `/map`)
3. ❌ **Page `/villes`** (hub régional avec cascade pays > ville > sport) — gros SEO local
4. ❌ **Pages `/disciplines/{sport}`** (national avec top clubs ranking par court count) — SEO + autorité éditoriale
5. ❌ **Retreats overlay** sur family-retraites (panel "Stages à venir", filtres hébergement/été, bouton "Réserver") — totalement absent
6. ❌ **Détection timezone** pour vue initiale continentale (V2 a IP geoloc mais pas TZ fallback)
7. ❌ **Boutons sport-spécifiques popup** (Anybuddy/coach/clubs/matériel selon famille) — lié à #111 affiliate mais pas couvert
8. ❌ **3 tailles de markers** (solo 30px / club 42px / court 20px) — visuellement absent
9. ❌ **Compteur dynamique "N spots affichés"** au filtrage — feedback UX qui manque
10. ❌ **Analytics Plausible** + event tracking — pas branché, on perd les métriques

---

## Zone : Carte interactive

- ✅ MapLibre GL + react-map-gl (paradigme MapLibre = équivalent fonctionnel de Leaflet V1) — #10
- ✅ Init vue par priorité (URL > localStorage > IP > timezone > défaut) (PR #133) — #120 fermée (sauf timezone, voir ❌ ci-dessous)
- ✅ Persistance viewport localStorage 60s (PR #133) — #120 fermée
- 🟡 Debounce sync URL 250ms (moveend) — #114 (issue ouverte)
- ❌ **Détection timezone** (30+ mappages Europe/Asie/Amériques/Afrique/Océanie) pour vue initiale continentale — fallback unique IP en V2, pas de TZ
- ✅ Tile layer OSM avec attribution — #10
- ❌ World copy jump (continuité est/ouest infinie) — à vérifier MapLibre
- ✅ Marker clustering (Supercluster) — #36
- ❌ 2 modes viewport (overview fitBounds vs focused zoom 5-17) — pas explicitement séparés
- ✅ Initial view per page programmatique (force override) — #15

## Zone : Popup pin

- ✅ Nom + ville + pays + sport emoji — #12
- ✅ Badge "N courts" sur les pins club (PR #148) — #126 fermée
- ❌ **3 tailles de markers** (solo 30px / club 42px / court 20px) — à créer
- ✅ Surface, opérateur, contact dans popup (PR #148) — #126 fermée (partiel — fiche `/venue/[slug]` reste à enrichir via #127)
- ✅ Étoile favori ☆/⭐ — #12
- ✅ Dropdown Itinéraire (Google/Apple/Waze) + auto-origin geoloc — #12
- ✅ Dropdown Partager (WhatsApp/Copy/Native) — #12
- ❌ **Liens boutons site officiel / Google Maps / Reviews / Photos Google** — pas couvert
- ❌ **Actions sport-spécifiques par famille** (raquette: Anybuddy/coach/clubs/matériel ; glisse: école/météo/location ; etc.) — lié à #111 affiliate mais pas couvert
- ✅ Emoji par sport_type (100+ types mappés) — #14
- ✅ Photo Wikimedia + extract Wikipedia dans popup (PR #142 import enrichments + PR #148 affichage) — #106 fermée, #107 reste pour fiche enrichie

## Zone : Vue club (clustering par lieu)

> Cette zone est **toujours absente du board V2** côté livraison. L'issue #130 a été ouverte pour tracker mais aucune PR à date.

- 🟡 Agrégation spots même location en "clubs" (useClubs flag V1) — #130 (issue ouverte)
- ❌ Club marker plus gros (42px) avec badge "[N] courts"
- ❌ Individual court markers apparaissent au zoom ≥ 16 autour du club
- ❌ Recycle markers par club_id pour perf
- ❌ Données club lues depuis structure `SH_COURTS_BY_CLUB` (équivalent DB à concevoir : colonne `club_id` sur `venue`?)
- ❌ Vue club active V1 sur 8/13 familles (raquette, fitness, hike, baignade, yoga, combat, glisse, autre) — à porter

## Zone : Filtres sidebar

- ✅ Barre recherche texte (ville/adresse/CP) avec debounce 300ms — #13
- ✅ Filtre sport multi-select sidebar — #11
- ✅ Pre-select via URL `?sport=tennis,padel` — #11
- ✅ Section sport toujours visible (pas en accordion) — #11
- ✅ Tout cocher / décocher par catégorie famille + Reset (PR #134) — #122 fermée
- ❌ **Compteur dynamique "N spots affichés"** au changement filtre — pas trackée
- ❌ **Sources reference en bas sidebar** (OSM, RES, Wikidata, Overture) — pas trackée
- ✅ Empty state contextuel par ville/sport/générique (PR #149) — #125 fermée

## Zone : Liste side-by-side (desktop ≥ 1100px)

- 🟡 Bouton "Liste" toggle panneau droit — #123 (issue ouverte)
- 🟡 Layout 3 colonnes desktop ≥ 1100px — #123
- 🟡 Tri par proximité au centre carte + debounce pan 300ms — #123 + #98
- ✅ Clic item liste → zoom carte + popup, panneau reste ouvert — #38
- ❌ **Sous-groupes "complexes"** (clubs avec installations multi : 3 tennis + 2 padel) avec expand/collapse — lié à vue club
- ❌ **Compteur "N complexes, M isolés"** par famille dans la liste — pas trackée

## Zone : Landing page (index.html)

- ✅ Hero gradient 2 lignes "Tous tes sports / Une seule carte" (PR #46) — #45
- ❌ **Barre recherche hero** ("Cherchez une ville, un spot, un sport…") — pas trackée
- ✅ Stats hero (~250k spots, 30+ sports, 13 familles, 4 sources) (PR #46) — #45
- ✅ Grille 13 cartes famille avec emoji + count + chips (PR #46) — #45
- 🟡 Chips sous-sports (62 total) → links `family-X.html?sport=Y` — partiellement ✅ via PR #134 (i18n), routage URL final à confirmer
- ✅ Section "Top clubs par sport" (10 cartes iconiques) (PR #105) — #82
- ✅ Section "Partenaires réservation" (6 logos) (PR #105) — #82
- ✅ Testimonials 3 profils (PR #105) — #82
- ✅ Section "Vision" 4 cartes (PR #105) — #82
- ✅ FAQ 8 questions (PR #105) — #82
- ✅ CTA banner "Un spot manque" (PR #105) — #82

## Zone : Navigation / Header / Footer

- ✅ Nav sticky top + brand SH — #8
- ✅ **Nav dropdown disciplines** (13 items avec emoji/nom/sous-titre/count au survol) (PR #151) — #131 fermée
- ✅ Liens nav Accueil / Disciplines / Villes / FAQ / Favoris / Explorer — #8 (partiel : manque Villes + Explorer — voir zones dédiées)
- ✅ Language switch FR/EN/中文 — #8 (placeholder), routes réelles via #108
- 🟡 Favoris badge dynamique rouge (N) en top-right — #91 (issue ouverte)
- ✅ Footer copyright + sources + crédits — #8

## Zone : Pages famille (13)

- ✅ 13 routes `/sports/{family}` avec redirects 301 depuis `/family-X.html` — #14 + #43

## Zone : Pages spécialisées (discipline nationale)

- ❌ `/disciplines/tennis.html` — top clubs France ranking par court count — pas trackée
- ❌ `/disciplines/padel.html` — top clubs France + podium
- ❌ `/disciplines/badminton.html`
- ❌ `/disciplines/squash.html`
- ❌ `/disciplines/table_tennis.html`

> Suggestion : route `/sports/[sport]/top-clubs` ou `/disciplines/[sport]` à créer, agrège par court count.

## Zone : Pages programmatiques (sport × ville)

- ✅ Routes `/[sport]/[country]/[city]` (POC 10 pages live + extension Phase 2) — #15
- ✅ Redirects V1 `/padel-paris.html` → `/padel/fr/paris` (301) — #43
- ✅ Initial view forcé (override geoloc) (PR #133) — #120 fermée

## Zone : Favoris (localStorage)

- ✅ Étoile popup ajouter/retirer favori — #12
- ✅ localStorage `sporthub_favorites` (spotIds[] + updatedAt) — #12
- ✅ Snapshot minimal `sporthub_fav_data` (name, lat, lon, family, type, city) — #12
- ❌ **Fallback gracieux quota exceeded** (mode privé) — pas trackée
- 🟡 Page `/favoris` grille cartes — #91 (DB persisté, issue ouverte)
- 🟡 Carte favori (emoji + nom + type + ville + CTA "Voir sur carte") — #91
- 🟡 Bouton suppression ✕ par carte — #91
- ❌ **Empty state favoris** avec CTA "Explorer" — pas explicitement trackée (peut-être à intégrer dans #91)

## Zone : Géolocalisation

- ✅ Bouton "Me localiser" (Locate control bottom-right) (PR #133) — #120 fermée
- ✅ `navigator.geolocation.getCurrentPosition` + fallback IP (PR #133) — #120 fermée
- ✅ Feedback "Localisation…" durant appel (PR #133) — #120 fermée
- ✅ Marker user + zoom 13 si succès (PR #133) — #120 fermée
- ✅ Message erreur si permission refusée (PR #133) — #120 fermée
- ✅ IP geoloc background (Vercel headers, mieux que ipapi.co V1) (PR #133) — #120 fermée
- ✅ Cache IP-geoloc localStorage TTL 24h (PR #133) — #120 fermée
- ❌ **Prompt discret "Voir les terrains près de toi ?"** si geoloc non accordée — pas explicitement dans #120

## Zone : Recherche

- ✅ Barre recherche sidebar + debounce 300ms — #13
- ✅ Bbox zoom auto si résultat unique — #13
- ❌ **Reverse geocoding** (city field manquant en V1, à vérifier en V2) — pas trackée
- ✅ Empty state recherche "Aucun résultat pour {ville}" (PR #149) — #125 fermée

## Zone : Explore page (multi-discipline unifiée)

- 🟡 **Page `/explore`** carte unifiée toutes 13 familles simultanément — #132 (fusion dans /map)
- ❌ **Picker overlay initial** (chips disciplines multi-select + input ville optionnel)
- 🟡 Chips disciplines check/uncheck + toggle "Tout / Aucune" — partiellement via #122 (PR #134) + #147 switcher famille — reste full multi-discipline
- ✅ Input ville libre — #13
- ❌ **Bouton "Explorer →"** gradient orange disabled si aucun filtre
- ❌ **Markers colorés par famille** quand multi-disciplines actives (13 couleurs distinctes) — pas trackée

## Zone : Villes page (hub régional)

- ❌ **Page `/villes`** hub régional — pas trackée
- ❌ **Cartes 4 villes phares** (Paris, Lyon, Marseille, Toulouse)
- ❌ **Cascade pays > ville > sport** filtrage dynamique
- ❌ **Liens cartes ville × sport** vers family-*.html?sport=&?q=ville
- ❌ **CTA "Ta ville n'est pas listée"** vers Explore

## Zone : Mobile responsive

- ✅ Nav responsive (gap + font-size adaptatifs) — #8
- ❌ **Sidebar collapse par défaut mobile < 540px** + toggle button hamburger — pas trackée
- ❌ **Sidebar ferme auto au dragstart** carte pour voir map sans scroll — pas trackée
- ✅ Hero responsive (font clamp + padding) (PR #46) — #45
- ✅ Family grid auto-fill (PR #46) — #45
- ✅ Popup responsive (width 90vw + ancre auto) (PR #148) — #126 fermée
- ❌ **Safe area iOS** sur MapLibre controls (margin-bottom + env(safe-area-inset-bottom)) — à vérifier
- ✅ Touch-friendly tap targets ≥ 44×44px (PR #148) — #126 fermée

## Zone : Internationalisation (FR/EN/ZH)

- ✅ Moteur i18n (data-i18n → next-intl) (PR #50, #54) — #84-86
- 🟡 Auto-détection langue (localStorage > Accept-Language > "fr") — #108 (issue ouverte)
- ✅ 3 dictionnaires FR/EN/中文 complets (PR #50, #54, #144) — #84-86
- ✅ Buttons switch FR/EN/中文 dans nav — #8
- ✅ Apply au mount + à chaque changement langue — next-intl
- ✅ Fallback texte par défaut si clé manquante — next-intl
- ✅ Placeholder i18n + custom attrs — next-intl
- 🟡 URL params cosmétique `?lang=en` → **vraies routes** `/en/*` `/zh/*` — #108 / #152 (issue ouverte)
- ✅ Traduction VenueCard "X terrain(s)" + labels sports (PR #134) — #85 fermée

## Zone : SEO / Métadonnées

- ✅ Canonical URL sur chaque page — #9 + #14 + #15
- 🟡 hreflang 4 versions (FR/EN/ZH/x-default) — #17 placeholder (mergée) + #108 vraies (ouverte)
- ✅ OG tags complets (type, site, locale, url, title, desc, image) — #9 + #45
- ✅ Twitter cards summary_large_image — #9
- ✅ JSON-LD WebSite + SearchAction (PR #105) — #82
- ✅ JSON-LD Organization (PR #105) — #82
- ✅ JSON-LD FAQPage (8 Q/R) (PR #105) — #82
- ✅ JSON-LD BreadcrumbList + ItemList sports (family pages) — #14
- ✅ JSON-LD SportsActivityLocation (venue) — #9
- 🟡 OG images 15 PNG 1200×630 par famille — #59 (regen emoji, ouverte) + #93 (dynamique next/og, ouverte)
- ❌ **Google Site Verification meta tag** — pas trackée
- ❌ **Meta description élaborée par famille** (~80 chars custom) — pas trackée (générique uniquement)

## Zone : Robots / Manifest IA

- ✅ Sitemap.xml dynamique multi-URLs + sitemap-index splitté 9 shards (PR #139) — #16 + #88 fermées
- 🟡 Schema.org enrichi sur programmatiques — #94 (issue ouverte)
- ❌ **robots.txt explicite** (allow GPTBot/ClaudeBot/PerplexityBot/Google-Extended/Applebot-Extended/CCBot/cohere-ai/Bytespider/MistralAI-User) — pas trackée
- ❌ **llms.txt manifest** (familles + endpoints data + comment citer) — pas trackée

## Zone : Empty states / Loading / Errors

- ✅ Loading state "Chargement…" pendant import (Suspense Next.js + skeleton /map — PR #48)
- ✅ Timeout handling avec refresh CTA (PR #149) — #125 fermée
- ✅ Empty générique "Aucun spot" (PR #149) — #125 fermée
- ✅ Empty par filtre "Aucun {sport} dans cette zone" (PR #149) — #125 fermée
- ✅ Empty search "Aucun spot pour {ville}" (PR #149) — #125 fermée
- ❌ **404 console silencieuses** clubs-X.js sur 6 familles V1 — résolu par migration (#58 v1-cleanup, side V1, issue toujours ouverte)
- ✅ Error boundary global (Sentry catch) (PR #138, #153) — #95 fermée

## Zone : Accessibility

- ✅ ARIA roles (nav menu, main, sections) — par shadcn/RSC
- ✅ aria-current="page" sur lien actif — par Next.js Link
- ✅ aria-label sur boutons icon-only — par shadcn
- ❌ **aria-expanded state** sur mobile sidebar toggle — pas trackée
- ✅ Focus visible — Tailwind defaults
- ✅ Semantic HTML — RSC + JSX
- ❌ **Audit color contrast** WCAG AA (4.5:1) sur tous les composants — pas trackée

## Zone : Retraites overlay (family-retraites spécifique)

- 🟡 Re-scraper / enrichir familles snow et retraites — #97 (issue ouverte)
- ❌ **`retreats-overlay.js`** injecté uniquement sur `/sports/retraites` — pas trackée
- ❌ **Panel "Stages à venir"** avec filtres (hébergement, été) + chips sports
- ❌ **Dates formatées par langue** ("25 juin → 2 juillet" / "25 Jun → 2 Jul" / "6月25日→7月2日")
- ❌ **Pricing + audience + level + lodging type** affichés
- ❌ **Bouton "Réserver ↗"** lien externe — recoupe #111 (affiliate)

## Zone : Analytics / Monitoring

- ✅ Sentry erreurs branché (PR #138, #153) — #95 fermée
- 🟡 PostHog produit branché — #96 (façade prête, wire en cours)
- ❌ **Plausible analytics** (V1 a déjà Plausible sur villes.html) — pas trackée
- ❌ **Event tracking** (page views, filter changes, favoris toggle) — pas trackée

---

## Δ depuis le dernier audit

Snapshot précédent dans le body de [#129](https://github.com/thsshm/sporthub/issues/129) : **2026-05-28**.

### Promotions 🟡 → ✅ (16)

| Item | PR | Issue |
|---|---|---|
| Init vue par priorité (URL / localStorage / IP / défaut) | PR #133 | #120 |
| Persistance viewport localStorage 60s | PR #133 | #120 |
| Bouton « Me localiser » + Locate control | PR #133 | #120 |
| `navigator.geolocation.getCurrentPosition` + fallback IP | PR #133 | #120 |
| Feedback « Localisation… » durant appel | PR #133 | #120 |
| Marker user + zoom 13 si succès | PR #133 | #120 |
| Message erreur si permission refusée | PR #133 | #120 |
| IP geoloc background (Vercel headers) | PR #133 | #120 |
| Cache IP-geoloc localStorage TTL 24h | PR #133 | #120 |
| Initial view forcé (override geoloc) sur programmatiques | PR #133 | #120 |
| Tout cocher / décocher par catégorie famille + Reset | PR #134 | #122 |
| Empty states contextuels + timeout handling (4 items) | PR #149 | #125 |
| Badge « N courts » sur pins club | PR #148 | #126 |
| Surface / opérateur / contact dans popup | PR #148 | #126 |
| Popup responsive (90vw + ancre auto) | PR #148 | #126 |
| Touch-friendly tap targets ≥ 44×44px | PR #148 | #126 |
| Traduction VenueCard « X terrain(s) » + labels sports | PR #134 | #85 |
| Photo Wikimedia + extract Wikipedia (popup) | PR #142 + PR #148 | #106 / #107 |
| Sitemap index splitté (50k → 360k venues) | PR #139 | #88 |
| Error boundary global Sentry | PR #138 + PR #153 | #95 |

### Promotions ❌ → ✅ (2)

| Item | PR | Issue |
|---|---|---|
| Nav dropdown disciplines (13 items emoji/nom/count) | PR #151 | #131 |
| Loading state « Chargement… » (Suspense + skeleton) | PR #48 (audit précédent l'avait raté) | — |

### Promotions ❌ → 🟡 (3 — issues nouvellement ouvertes)

| Item | Issue ouverte |
|---|---|
| Page `/explore` carte unifiée multi-disciplines | #132 (fusion `/map`) |
| Vue club V1 (1 pin = 1 établissement) | #130 |
| Vraies routes i18n `/en/*` `/zh/*` (double tracking #108 + #152) | #108 / #152 |

### PRs en review au moment du snapshot (impact futur)

| PR | Zone impactée | Issue ciblée |
|---|---|---|
| #145 (perf API venues — Edge runtime + minimal payload + CDN cache) | Carte interactive / perf | #113 |
| #158 (partial index published + audit runbook) | Carte interactive / perf | #115 |
| #159 (i18n ClaimForm FR/EN/ZH) | i18n | #86 |
| #160 (DB maintenance runbook — VACUUM, EXPLAIN) | Carte interactive / perf | #115 |
| #161 (fiche `/venue/[slug]` enrichie — horaires, tél, web, amenities, photos) | Popup pin / venue | #127 |

### Issues fermées depuis le dernier audit (récap)

`#84` (i18n admin), `#85` (i18n VenueCard), `#88` (sitemap split), `#95` (Sentry wire), `#101` (antimeridian), `#106` (Wikidata enrichments), `#120` (géoloc), `#121` (switcher famille), `#122` (cocher/décocher + reset), `#124` (rechercher dans cette zone), `#125` (empty states), `#126` (popup pin enrichie), `#131` (nav dropdown), `#143` (timeout bbox mondiale).

---

**Pour Claude Code** : ce snapshot est **dérivé** de l'issue #129. Quand tu touches une PR qui déplace un item ici, mets aussi à jour le body de #129 — c'est la source de vérité.
