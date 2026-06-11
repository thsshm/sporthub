#!/usr/bin/env node
/**
 * Smoke test SEO des pages publiques critiques (#587, étendu #634).
 *
 * Détecte les régressions vécues (cf. #550/#551/#552/#556/#466) :
 *   - page sport « No venue » alors que le sport est peuplé ;
 *   - page sport×ville « No address » alors que des venues existent ;
 *   - vieux compteur hardcodé (« 250 000+ », « 267 000 »…) resté dans le HTML ;
 *   - /map qui SSR un faux état vide (« No spots in this area ») ;
 *   - compteur /developers incohérent avec celui de la home.
 *
 * Détection de régression, pas QA exhaustive : fetch HTML brut (pas de
 * navigateur — Playwright serait disproportionné ici), assertions sur des
 * chaînes EN stables (messages/en.json). Tourne contre la prod par défaut :
 *   node scripts/seo-smoke.mjs [baseUrl]
 *   BASE_URL=https://preview.vercel.app node scripts/seo-smoke.mjs
 *
 * Exit 0 si tout passe, 1 sinon (utilisable en CI/cron).
 */

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "https://sporthub-git-main-gautier-ths.vercel.app"
).replace(/\/$/, "");

// Chaînes du cas « =0 » des plurals EN (messages/en.json). Si ces clés changent,
// adapter ici — le test échouera de toute façon par non-détection du compteur.
const NO_VENUE = "No venue";
const NO_ADDRESS = "No address";
const MAP_FALSE_EMPTY = ["No spots in this area", "0 spots in view"];
// Compteurs périmés connus, hardcodés par le passé (#556/#557).
const STALE_COUNTS = ["250,000+", "250 000+", "267,000", "267 000", "250000+"];

/** Pages sport / sport×ville réputées peuplées (issue #587 + sports populaires
 * de #550). Sur celles-ci, « No venue » / « No address » = régression. */
const POPULATED_PAGES = [
  "/en/sports/tennis",
  "/en/sports/padel",
  "/en/sports/yoga",
  "/en/sports/gym",
  "/en/sports/football",
  "/en/sports/basketball",
  "/en/sports/petanque",
  "/en/padel/fr/paris",
  "/en/petanque/fr/marseille",
  "/en/football/fr/lille",
  "/en/basketball/fr/rennes",
  // gym = le PLUS GROS sport (~140k). La page sport×ville utilise getVisibleVenueCount
  // en count:'exact' → sans l'index (sport_slug, city_id) de la MV (migration 0058)
  // le COUNT(*) timeout → page vide en SILENCE. Garde-fou si un futur rebuild de la
  // MV oublie de recréer cet index (0056 l'avait DROP+CREATE).
  "/en/gym/fr/lyon",
  // Extension #634 : URLs de l'audit produit (régression #633 vécue sur
  // gym/paris — total par APPARTENANCE (MV) > 0 mais liste fetchée par
  // primary_sport_slug vide → « No address » avec « 890 total »).
  "/en/tennis/fr/lyon",
  "/en/gym/fr/paris",
  "/en/gym/fr/toulouse",
];

const failures = [];
const warnings = [];

function fail(page, msg) {
  failures.push(`✗ ${page} — ${msg}`);
}

/** Retire les blocs <script> (payload RSC/i18n inliné) : les messages ICU bruts
 * (`=0 {No venue}`) y figurent TOUJOURS, même quand la page affiche des venues
 * → on n'analyse que le HTML visible, sinon 100 % de faux positifs. */
function stripScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

async function fetchPage(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "sporthub-seo-smoke/1 (+#587)" },
  });
  const html = res.ok ? stripScripts(await res.text()) : "";
  return { status: res.status, html };
}

/** Extrait le compteur de spots « N spots » (home hero / intro developers).
 * Tolère les séparateurs , . espace/NNBSP. Retourne null si introuvable. */
function extractSpotsCount(html) {
  const m = html.match(/([\d][\d\s  .,]{2,})\s*(?:sports\s+)?spots\b/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function checkPopulatedPage(path) {
  let { status, html } = await fetchPage(path);
  if (status !== 200) return fail(path, `HTTP ${status} (attendu 200)`);
  // Retry-sur-vide : l'app a des renders vides TRANSITOIRES (fenêtre de REFRESH
  // de la MV, cold start) — vu en live le 2026-06-11. Un seul fetch ferait
  // « crier au loup » le cron. On re-fetch une fois avant de conclure : un vide
  // persistant échoue toujours, un transitoire est absorbé.
  const isEmpty = (h) => h.includes(NO_VENUE) || h.includes(NO_ADDRESS);
  if (isEmpty(html)) {
    await new Promise((r) => setTimeout(r, 2500));
    ({ status, html } = await fetchPage(path));
    if (status !== 200) return fail(path, `HTTP ${status} au retry (attendu 200)`);
  }
  if (html.includes(NO_VENUE)) fail(path, `affiche « ${NO_VENUE} » (sport réputé peuplé)`);
  if (html.includes(NO_ADDRESS)) fail(path, `affiche « ${NO_ADDRESS} » (ville réputée peuplée)`);
  // #634 — check positif : au-delà de l'absence du message vide, la page doit
  // RÉELLEMENT lister des venues (≥ 1 lien /venue/). Attrape une grille vide
  // silencieuse (ex. fetch qui échoue → liste vide sans état « No address »,
  // ou divergence count-par-appartenance vs liste-par-primary, régression #633).
  if (!/href="[^"]*\/venue\//.test(html)) {
    fail(path, "aucun lien /venue/ dans le HTML (liste vide alors que la page est réputée peuplée)");
  }
  for (const stale of STALE_COUNTS) {
    if (html.includes(stale)) fail(path, `compteur périmé hardcodé « ${stale} »`);
  }
}

async function checkMap() {
  const { status, html } = await fetchPage("/en/map");
  if (status !== 200) return fail("/en/map", `HTTP ${status}`);
  // Le HTML INITIAL (SSR) ne doit jamais contenir un faux état vide : l'overlay
  // « 0 spots » est un rendu client post-fetch (#466). S'il apparaît côté
  // serveur, un crawler voit une carte « vide ».
  for (const s of MAP_FALSE_EMPTY) {
    if (html.includes(s)) fail("/en/map", `faux état vide SSR : « ${s} »`);
  }
}

async function checkCountsConsistency() {
  const [home, dev] = await Promise.all([fetchPage("/en"), fetchPage("/en/developers")]);
  if (home.status !== 200) return fail("/en", `HTTP ${home.status}`);
  if (dev.status !== 200) return fail("/en/developers", `HTTP ${dev.status}`);

  for (const stale of STALE_COUNTS) {
    if (home.html.includes(stale)) fail("/en", `compteur périmé hardcodé « ${stale} »`);
    if (dev.html.includes(stale)) fail("/en/developers", `compteur périmé hardcodé « ${stale} »`);
  }

  const homeCount = extractSpotsCount(home.html);
  const devCount = extractSpotsCount(dev.html);
  if (homeCount == null)
    return warnings.push(`? /en — compteur de spots introuvable (markup changé ?)`);
  if (devCount == null)
    return warnings.push(`? /en/developers — compteur de spots introuvable (markup changé ?)`);
  // Même source (getTotalSpots) mais caches ISR distincts → tolérance 10 %.
  const drift = Math.abs(homeCount - devCount) / Math.max(homeCount, devCount);
  if (drift > 0.1) {
    fail(
      "/en/developers",
      `compteur (${devCount.toLocaleString("en")}) incohérent avec la home (${homeCount.toLocaleString("en")}) — écart ${(drift * 100).toFixed(0)} %`
    );
  }
}

const t0 = Date.now();
console.log(`SEO smoke (#587) — base: ${BASE}`);

await Promise.all([
  ...POPULATED_PAGES.map((p) => checkPopulatedPage(p)),
  checkMap(),
  checkCountsConsistency(),
]);

const dt = ((Date.now() - t0) / 1000).toFixed(1);
for (const w of warnings) console.warn(w);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n✗ SEO smoke : ${failures.length} échec(s) en ${dt}s`);
  process.exit(1);
}
console.log(`✓ SEO smoke OK — ${POPULATED_PAGES.length + 2} pages vérifiées en ${dt}s`);
