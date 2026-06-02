import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMigrations } from "./check-migrations.mjs";

/** Crée un dossier temp avec les fichiers nommés donnés (contenu vide). */
function fixture(names) {
  const dir = mkdtempSync(join(tmpdir(), "migcheck-"));
  for (const n of names) writeFileSync(join(dir, n), "-- sql\n");
  created.push(dir);
  return dir;
}
const created = [];
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("checkMigrations", () => {
  it("valide une séquence propre sans erreur", () => {
    const r = checkMigrations(
      fixture(["0001_init.sql", "0002_postgis.sql", "0003_user_favorite.sql"])
    );
    expect(r.errors).toEqual([]);
    expect(r.count).toBe(3);
  });

  it("détecte une collision de numéro (cause racine #228)", () => {
    const r = checkMigrations(fixture(["0011_affiliate.sql", "0011_zoom_tier.sql"]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("Collision de numéro 0011");
    expect(r.errors[0]).toContain("0011_affiliate.sql");
    expect(r.errors[0]).toContain("0011_zoom_tier.sql");
  });

  it("détecte un triple doublon", () => {
    const r = checkMigrations(fixture(["0015_a.sql", "0015_b.sql", "0015_c.sql"]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("(3 fichiers)");
  });

  it("rejette un format invalide (pas 4 chiffres)", () => {
    const r = checkMigrations(fixture(["1_init.sql", "abc_foo.sql"]));
    expect(r.errors.length).toBe(2);
    expect(r.errors.every((e) => e.includes("Format invalide"))).toBe(true);
  });

  it("rejette un nom sans description", () => {
    const r = checkMigrations(fixture(["0001.sql"]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("Format invalide");
  });

  it("tolère les trous historiques en warning, pas en erreur", () => {
    const r = checkMigrations(fixture(["0001_init.sql", "0003_postgis.sql", "0009_idx.sql"]));
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toContain("0002");
  });

  it("ignore les fichiers non-.sql", () => {
    const r = checkMigrations(fixture(["0001_init.sql", "README.md", ".gitkeep"]));
    expect(r.errors).toEqual([]);
    expect(r.count).toBe(1);
  });

  it("accepte les descriptions multi-segments snake_case", () => {
    const r = checkMigrations(fixture(["0012_partner_referential_rgpd.sql"]));
    expect(r.errors).toEqual([]);
  });
});

// Garde-fou sur le VRAI dossier supabase/migrations/ (pas un fixture). Les
// tests ci-dessus prouvent que la logique détecte les collisions ; celui-ci
// fait échouer `pnpm test` si une collision a réellement atterri sur la
// branche — exactement le cas vécu (double 0028 et double 0029 introduits par
// des PR concurrentes mergées en parallèle). checkMigrations() sans argument
// vise le dossier réel (MIGRATIONS_DIR).
describe("supabase/migrations réel", () => {
  it("ne contient aucune collision ni format invalide", () => {
    const r = checkMigrations();
    expect(r.errors).toEqual([]);
    expect(r.count).toBeGreaterThan(0);
  });
});
