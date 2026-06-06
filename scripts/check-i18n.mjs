#!/usr/bin/env node
/**
 * Gate CI i18n — empêche la classe de bug du « carte/page blanche » :
 * une famille/sport ajoutée au code (lib/families.ts, lib/sports.ts) sans sa
 * clé de traduction → `next-intl` lève MISSING_MESSAGE au render → le composant
 * Nav (dans le layout, donc toutes les pages) crashe → page blanche.
 * (Régression réelle : `families.escalade` manquante, #312.)
 *
 * Deux règles dures :
 *   1. COUVERTURE  — chaque slug de FAMILIES ⊂ messages.families, chaque slug
 *                    de SPORTS ⊂ messages.sports, DANS CHAQUE locale.
 *   2. PARITÉ      — toutes les locales exposent exactement le même ensemble de
 *                    clés (sinon une clé ajoutée en fr et oubliée en zh casse
 *                    /zh/*). next-intl exige cette parité de toute façon.
 *
 * Zéro dépendance (fs natif) → tourne en CI sans build, et en local via
 * `node scripts/check-i18n.mjs` (= `pnpm check:i18n`).
 *
 * Exit 1 si une règle est violée, 0 sinon.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_DIR = join(ROOT, "messages");

/** Extrait les `slug: "x"` d'un fichier TS, en excluant `family_slug:`/`*_slug:`. */
function extractSlugs(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  return [...src.matchAll(/(?<![_A-Za-z])slug:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

/** Aplati un objet de messages en chemins pointés (les feuilles = strings). */
function flattenKeys(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flattenKeys(v, path));
    else out.push(path);
  }
  return out;
}

const familySlugs = [...new Set(extractSlugs("lib/families.ts"))];
const sportSlugs = [...new Set(extractSlugs("lib/sports.ts"))];

const locales = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const messages = Object.fromEntries(
  locales.map((l) => [l, JSON.parse(readFileSync(join(MESSAGES_DIR, `${l}.json`), "utf8"))]),
);

const errors = [];

// ── Règle 1 : couverture des slugs familles + sports ────────────────────────
for (const locale of locales) {
  const m = messages[locale];
  for (const slug of familySlugs) {
    if (!m.families || m.families[slug] === undefined) {
      errors.push(`[${locale}] famille « ${slug} » sans clé i18n (families.${slug})`);
    }
  }
  for (const slug of sportSlugs) {
    if (!m.sports || m.sports[slug] === undefined) {
      errors.push(`[${locale}] sport « ${slug} » sans clé i18n (sports.${slug})`);
    }
  }
}

// ── Règle 2 : parité des clés entre locales ─────────────────────────────────
const keysByLocale = Object.fromEntries(locales.map((l) => [l, new Set(flattenKeys(messages[l]))]));
const allKeys = new Set(locales.flatMap((l) => [...keysByLocale[l]]));
for (const locale of locales) {
  for (const key of allKeys) {
    if (!keysByLocale[locale].has(key)) {
      errors.push(`[${locale}] clé manquante (présente dans une autre locale) : ${key}`);
    }
  }
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const counts = `${familySlugs.length} familles · ${sportSlugs.length} sports · locales: ${locales.join(", ")}`;
if (errors.length === 0) {
  console.log(`✓ i18n OK — ${counts}`);
  process.exit(0);
}
console.error(`✗ i18n — ${errors.length} problème(s) (${counts}) :`);
for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
if (errors.length > 50) console.error(`  … (+${errors.length - 50})`);
process.exit(1);
