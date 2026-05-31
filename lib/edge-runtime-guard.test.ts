import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde-fou anti-footgun (issue #230).
 *
 * `@supabase/ssr` (via getSupabaseServerClient / getSupabaseAdminClient) importe
 * `next/headers` au niveau module → INTERDIT en Edge runtime. Un route handler
 * qui déclare `runtime = "edge"` ET importe l'un de ces clients compile + passe
 * le CI, mais renvoie un 500 au runtime prod (cf. #206, #230).
 *
 * Ce test échoue si une telle combinaison réapparaît. Le client compatible Edge
 * est `getSupabaseEdgeClient` (service_role, sans next/headers).
 */

const APP_DIR = join(__dirname, "..", "app");
const FORBIDDEN_IN_EDGE = [
  "getSupabaseServerClient",
  "getSupabaseAdminClient",
  "getSupabaseStaticClient",
];

/** Liste récursive de tous les route.ts sous app/. */
function findRouteHandlers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRouteHandlers(full));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

const declaresEdge = (src: string) => /export\s+const\s+runtime\s*=\s*["']edge["']/.test(src);

describe("edge runtime guard (#230)", () => {
  const handlers = findRouteHandlers(APP_DIR);

  it("trouve au moins un route handler (sanity)", () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it("aucun route Edge n'importe un client Supabase incompatible (next/headers)", () => {
    const offenders: string[] = [];
    for (const file of handlers) {
      const src = readFileSync(file, "utf8");
      if (!declaresEdge(src)) continue;

      // On ne regarde QUE le code réel : on retire les commentaires (// … et
      // /* … */) pour éviter les faux positifs sur les routes qui EXPLIQUENT
      // en commentaire pourquoi elles n'utilisent pas le client admin.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      for (const fn of FORBIDDEN_IN_EDGE) {
        // import { … fn … } OU appel fn(
        const imported = new RegExp(
          `import[\\s\\S]*?\\b${fn}\\b[\\s\\S]*?from\\s+["']@/lib/supabase/server["']`
        ).test(code);
        const called = new RegExp(`\\b${fn}\\s*\\(`).test(code);
        if (imported || called) {
          offenders.push(`${file} → utilise ${fn} sous runtime="edge"`);
        }
      }
    }
    expect(
      offenders,
      `Route(s) Edge avec client Supabase incompatible (next/headers).\n` +
        `→ remplacer par getSupabaseEdgeClient.\n` +
        offenders.join("\n")
    ).toEqual([]);
  });
});
