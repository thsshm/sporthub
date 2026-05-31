#!/usr/bin/env node
/**
 * Gate CI sur les migrations Supabase (issue #228).
 *
 * Vérifie `supabase/migrations/` pour la classe de bugs vécue en direct cette
 * semaine (collisions 0011, 0014/0015, renumérotages pendant merges) :
 *
 *   1. FORMAT       — chaque fichier suit `NNNN_description.sql` (4 chiffres).
 *   2. DOUBLON      — aucun préfixe numérique en double (la cause racine des
 *                     collisions entre PRs concurrentes). ÉCHEC dur.
 *   3. SÉQUENCE     — signale les trous de numérotation (warning, non bloquant :
 *                     des trous historiques existent — 0002, 0008 — et sont OK).
 *
 * Volontairement zéro dépendance (fs natif) → tourne en CI sans install, et
 * en local via `node scripts/check-migrations.mjs`.
 *
 * Exit 1 si une règle dure (format ou doublon) est violée, 0 sinon.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations"
);

const NAME_RE = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** Analyse le dossier et renvoie { errors, warnings, count }. */
export function checkMigrations(dir = MIGRATIONS_DIR) {
  const errors = [];
  const warnings = [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // 1. FORMAT
  const malformed = files.filter((f) => !NAME_RE.test(f));
  for (const f of malformed) {
    errors.push(`Format invalide: "${f}" — attendu NNNN_description.sql (4 chiffres, snake_case).`);
  }

  // Numéros valides → détection doublons + trous.
  const byNum = new Map(); // num(string) -> [files]
  for (const f of files) {
    const m = f.match(NAME_RE);
    if (!m) continue;
    const num = m[1];
    if (!byNum.has(num)) byNum.set(num, []);
    byNum.get(num).push(f);
  }

  // 2. DOUBLON (échec dur — cause racine des collisions)
  for (const [num, group] of byNum) {
    if (group.length > 1) {
      errors.push(
        `Collision de numéro ${num} (${group.length} fichiers): ${group.join(", ")}. ` +
          `Renuméroter le(s) plus récent(s) sur le prochain numéro libre.`
      );
    }
  }

  // 3. SÉQUENCE (warning seulement — trous historiques tolérés)
  const nums = [...byNum.keys()].map(Number).sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    const gap = nums[i] - nums[i - 1];
    if (gap > 1) {
      const missing = [];
      for (let n = nums[i - 1] + 1; n < nums[i]; n++) {
        missing.push(String(n).padStart(4, "0"));
      }
      warnings.push(
        `Trou de numérotation après ${String(nums[i - 1]).padStart(4, "0")}: ` +
          `manque ${missing.join(", ")} (toléré si historique).`
      );
    }
  }

  return { errors, warnings, count: byNum.size };
}

// Exécution directe (pas en import depuis les tests).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const { errors, warnings, count } = checkMigrations();
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`✖ ${e}`);
    console.error(`\n✖ Gate migrations: ${errors.length} erreur(s) sur ${count} migration(s).`);
    process.exit(1);
  }
  console.log(`✓ Gate migrations: ${count} migration(s), numérotation valide, aucun doublon.`);
}
