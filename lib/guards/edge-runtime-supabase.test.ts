/**
 * Garde-fou anti-footgun (#230) : une route déclarant `runtime = "edge"` ne
 * doit JAMAIS importer getSupabaseAdminClient / getSupabaseServerClient.
 *
 * Pourquoi : ces deux helpers passent par @supabase/ssr, qui importe
 * `next/headers` AU NIVEAU MODULE → interdit en Edge runtime. Le build/CI
 * passe au vert mais la route renvoie un 500 au runtime prod (cf. PR #206 qui
 * était tombée dans le piège). En Edge, utiliser `getSupabaseEdgeClient`
 * (createClient de @supabase/supabase-js, sans next/headers).
 *
 * Ce test scanne `app/` et échoue (= CI rouge) si une route Edge réintroduit
 * le footgun → attrapé en CI, pas en prod.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "app");

// `export const runtime = "edge"` (simple ou double quotes, espaces variables).
const DECLARES_EDGE = /export\s+const\s+runtime\s*=\s*["']edge["']/;

// IMPORT (pas une simple mention en commentaire) d'un client ssr depuis
// @/lib/supabase/server. On cible la ligne d'import → les commentaires qui
// citent getSupabaseAdminClient (ex /api/venues, qui explique pourquoi il ne
// l'utilise PAS) ne déclenchent pas de faux positif.
const IMPORTS_SSR_CLIENT =
  /import\s*\{[^}]*\bgetSupabase(?:Admin|Server)Client\b[^}]*\}\s*from\s*["']@\/lib\/supabase\/server["']/;

// Exceptions connues, à résorber. Chaque entrée DOIT pointer une issue/PR de
// suivi. Quand la migration a mergé, retirer l'entrée (elle devient un no-op
// inoffensif d'ici là).
const ALLOWLIST = new Set<string>([
  // Migration en cours via #235 (drop service_role du chemin public clubs).
  "app/api/venues/clubs/route.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("Edge runtime guard — clients Supabase (#230)", () => {
  it("aucune route Edge n'importe getSupabaseAdminClient/getSupabaseServerClient", () => {
    const violations: string[] = [];
    for (const file of walk(APP_DIR)) {
      const src = readFileSync(file, "utf8");
      if (!DECLARES_EDGE.test(src)) continue;
      if (!IMPORTS_SSR_CLIENT.test(src)) continue;
      const rel = relative(ROOT, file);
      if (!ALLOWLIST.has(rel)) violations.push(rel);
    }
    expect(
      violations,
      `Route(s) Edge important un client Supabase @supabase/ssr (next/headers ` +
        `au niveau module → 500 en prod malgré CI verte). Remplacer par ` +
        `getSupabaseEdgeClient. Fichier(s) : ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("détecte bien le footgun (sanity check du scanner)", () => {
    // Garantit que la regex matche un vrai cas — évite un test qui passe
    // parce qu'il ne détecte plus rien (faux négatif silencieux).
    const sample =
      `export const runtime = "edge";\n` +
      `import { getSupabaseAdminClient } from "@/lib/supabase/server";`;
    expect(DECLARES_EDGE.test(sample)).toBe(true);
    expect(IMPORTS_SSR_CLIENT.test(sample)).toBe(true);
    // Et qu'une mention en commentaire NE matche PAS (cas /api/venues).
    const comment = `// on n'utilise pas getSupabaseAdminClient ici\n` +
      `import { getSupabaseEdgeClient } from "@/lib/supabase/server";`;
    expect(IMPORTS_SSR_CLIENT.test(comment)).toBe(false);
  });
});
