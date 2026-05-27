# SportHub — Product Spec

## Vision

> **Une seule carte pour tous tes sports.**
> Trouve où pratiquer en quelques secondes, partout dans le monde. Données ouvertes, sans pub, sans inscription.

## Pourquoi maintenant

- Annuaires sportifs FR/EN fragmentés : 1 app par sport (Anybuddy padel, Playtomic padel, FFT tennis, Mindbody yoga, Surf-Forecast…).
- Données publiques existantes (OSM, RES, Wikidata) sous-exploitées : la donnée est là, personne ne l'agrège proprement avec une UX cartographique.
- Marché du sport en croissance (+30 %/an padel France, boom du running/trail, mondialisation des camps de surf).

## Personas

### 1. Sportif loisir (cible principale FR Phase 1-2)
**Profil** : 25-50 ans, ville française, pratique 1-2 sports régulièrement (padel, tennis, course, salle de sport).
**Job to be done** : "Je cherche où jouer au padel ce week-end, dans mon quartier ou en déplacement."
**Friction actuelle** : Doit jongler entre 3-4 apps/sites pour trouver un terrain dispo près de chez lui.
**Promesse SportHub** : Une carte, un filtre, un clic → trouve le club, vois les horaires/contacts, va vers Anybuddy pour réserver.

### 2. Passionné multidiscipline
**Profil** : 30-55 ans, pratique 3+ sports (tennis + padel + ski + surf en vacances).
**Job to be done** : "Je voyage à Lisbonne, je veux savoir où jouer au padel ET surfer ET courir sur la plage."
**Promesse** : Une carte mondiale unique, pas besoin de re-créer un compte par sport/ville.

### 3. Club / lieu de pratique
**Profil** : Gestionnaire d'un club tennis municipal, gym indépendante, école de surf.
**Job to be done** : "Je veux que les gens trouvent mon club, voient mes horaires, mes prix, et puissent réserver."
**Promesse** : "Revendique ta fiche" gratuit, enrichis les infos, choisis ton partenaire de booking (Anybuddy, Playtomic, MindBody).

### 4. Voyageur sportif
**Profil** : Travel + sport, planning vacances avec activité.
**Job to be done** : "Je vais à Tarifa la semaine prochaine, je veux voir les spots de kite + les écoles + les bonnes plages."
**Promesse** : Carte mondiale + retraites & camps + conditions live (vent/houle/neige — Phase 5+).

## Use cases prioritaires (Phase 2)

| # | Use case | Page cible |
|---|---|---|
| 1 | "Padel à Paris" | `/padel/fr/paris` |
| 2 | "Détail Tennis Club d'Auteuil" | `/venue/tennis-club-d-auteuil-paris` |
| 3 | "Carte avec filtres pour explorer ma région" | `/map?bbox=...&sports=padel,tennis` |
| 4 | "Tous les sports à Paris" | `/villes/paris` ou `/sports?city=paris` |
| 5 | "Yoga dans tel quartier" | `/yoga/fr/paris-11` (programmatique) |

## Métriques de succès

### Acquisition (Phase 2-3)
- **Visites organic Google** : objectif 10k/mois à M6, 50k/mois à M12
- **Pages indexées par Google** : > 5 000 (vs 36 actuellement en V1)
- **Top 10 sur "padel paris"** : Phase 3 objectif
- **Top 3 sur "padel <city>" pour 30 villes FR** : M12 objectif

### Engagement (Phase 3+)
- **Sessions / utilisateur** : > 2 (= utilisateurs reviennent)
- **Spots favoris créés / DAU** : > 1
- **CTR vers partenaires booking** (Anybuddy/Playtomic) : > 10 % des sessions visitant `/venue/[slug]`

### Monétisation (Phase 4+, à définir)
- **Clubs claim leur fiche** : > 100 à M12
- **Conversion booking partenaires** : à mesurer après cutover (Phase 4 + 1 mois)

## Non-objectifs explicites

Pour ne pas s'éparpiller, **ce qu'on NE fait PAS** :

- ❌ **Réservation directe** (Anybuddy/Playtomic le font mieux, on est leur point d'entrée)
- ❌ **Social / messagerie** (pas de "trouve un partenaire de jeu", c'est un autre produit)
- ❌ **Coaching / cours en ligne** (Superprof, ClassPass le font)
- ❌ **Fitness tracking** (Strava, MyFitnessPal)
- ❌ **Vente d'équipement** (e-commerce, hors scope)
- ❌ **News sport** (L'Équipe, Eurosport)

Notre cercle : **discovery + détail + redirect vers le partenaire qui ferme la transaction**. Point.

## Différenciateurs

1. **Mondial dès le début** (vs Anybuddy France-only, Tenup tennis-only)
2. **Multi-discipline** (vs apps mono-sport)
3. **Open data** (vs DBs propriétaires fragmentées)
4. **Pas de pub, pas de social, pas de compte requis** (vs apps trackés/intrusives)
5. **SEO-first** (pages programmatiques par sport × ville indexées en masse)
