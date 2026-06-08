# Spike — sources d'enrichissement padel FR (#345)

_Daté du 2026-06-08. Conclusions issues de tests live des API (pas de doc tierce)._

## Pourquoi ce doc

Le pipeline #345 enrichit les venues padel FR depuis **Playtomic**. Le dry-run
national a révélé un plafond : **Playtomic n'expose que ~125 clubs padel en
France** (vérifié — voir ci-dessous), dont **6 correspondent à nos venues
existantes**. Playtomic est dominant en Espagne, pas en France. Ce doc cadre les
sources alternatives à fort volume pour une décision ultérieure.

## Comparatif des sources

| Source | Accès | Volume FR | Données utiles | Verdict |
| --- | --- | --- | --- | --- |
| **Playtomic** | Public, **sans auth** | ~125 clubs | nom, géo, courts indoor/outdoor, booking_url | ✅ **livré** (pipeline #345), mais volume faible |
| **Anybuddy** | API partenaire, **Basic auth + `X-Anybuddy-Club-Api-Key`** | ~15 000 courts (FR/BE/ES/CH) | nom, adresse, **lat/lon, nb courts, sports, surfaces, description, prix** | 🔑 nécessite une **clé partenaire Anybuddy** |
| **Ten'Up (FFT)** | `tenup.fft.fr`, **anti-bot** (cookie/JS) | Très large (référentiel FFT) | clubs tennis+padel FR | 🤖 nécessite **navigateur/Bright Data** |

### Détails vérifiés en live (2026-06-08)

**Playtomic** — `GET api.playtomic.io/v1/tenants?sport_id=PADEL&coordinate=lat,lon&radius=…`
- Sans auth, renvoie le **top ~28 clubs les plus proches** par requête (cap dur :
  `size=500` renvoie quand même 28 à Paris).
- Test de saturation Île-de-France : maille large (15 cellules) → 34 clubs FR ;
  maille fine (190 cellules) → 32. **Densifier n'apporte rien** → ~125 est le
  catalogue FR réel, pas un artefact d'échantillonnage.
- Chaque club porte `address.country_code` → filtrage FR fiable (les recherches
  près des frontières renvoient des clubs ES/BE/DE/IT/CH).

**Anybuddy** — API « Booking Public API » (blueprint Apiary `anybuddyapibooking`).
- Endpoints : `GET /v1/centers` (« Get all centers », **supporte `text/csv`**),
  `GET /v1/centers/{centerId}`, `GET /v2/centers/{centerId}/availabilities`.
- **Auth obligatoire** : `Authorization: Basic user:pass` (+ `X-Anybuddy-Club-Api-Key`).
  Vérifié : `GET /v1/centers` sans header → **HTTP 403**.
- Réponse riche. Exemple de ligne CSV documentée :
  `colombes-tc,Tennis Club Colombes,48.928507,2.236646,"Parc Ile Marante, 92700 Colombes",92700,Colombes,Île-de-France,FR,EUR 28.00,EUR 9.00,tennis,10,…,"10 terrains en Terre battue,10 terrains en Green Set"`
  → id, nom, **lat, lon**, adresse, CP, ville, région, pays, prix, **sport, nb
  courts, surfaces, description**.
- `GET /v1/centers` retourne **tout le catalogue** en un appel (idéal pour un
  import en masse, pas de grille géo nécessaire).

**Ten'Up (FFT)** — `tenup.fft.fr/api/recherche/clubs?discipline=PADEL`
- Renvoie une page HTML avec test cookie/JS (anti-bot), pas de JSON exploitable
  en HTTP simple. Nécessiterait un navigateur headless ou un proxy anti-bot.

## Recommandation

1. **Court terme** — livrer l'apply Playtomic déjà construit (6 venues haute
   confiance) dès que la migration `0048` est en prod. Valeur réelle, risque nul.
2. **Volume FR** — obtenir une **clé partenaire Anybuddy** (contact :
   `support@anybuddyapp.com`). `GET /v1/centers` donne le catalogue complet
   (~15k courts) avec géo + courts + sports → un importer propre (sur le modèle
   `scrape_playtomic_padel_fr.py`) permettrait non seulement d'**enrichir** mais
   d'**ajouter** les clubs padel FR absents de nos données OSM/Overture. C'est le
   chantier à fort ROI.
3. **Ten'Up** — uniquement viable avec une infra anti-bot (Bright Data). Priorité
   basse tant qu'Anybuddy n'est pas exploité.

## Note d'accès (contraintes rencontrées)

L'apply Playtomic et tout import nécessitant l'écriture DB butent sur les
credentials Supabase (`SUPABASE_ACCESS_TOKEN` / `DB_PASSWORD`), absents côté
GitHub Actions (seuls `SUPABASE_URL` + `SERVICE_ROLE_KEY` y sont) et non lisibles
en local (règle de sécurité sur `.env.local`). La migration `0048` doit donc être
poussée manuellement (`./scripts/db-push.sh` ou SQL Editor) avant l'apply.
