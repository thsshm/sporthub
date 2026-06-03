import { defineConfig } from "vitest/config";
import path from "node:path";

// Config Vitest pour SportHub. Cible : helpers `lib/` (pas les pages Next.js).
// Environnement `node` suffit — pas de DOM nécessaire pour les helpers purs.
// L'alias `@/` reproduit le mapping tsconfig.json paths.

export default defineConfig({
  test: {
    environment: "node",
    // Helpers lib/ (TS) + scripts utilitaires testables (.mjs, ex. gate migrations #228).
    include: ["lib/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/supabase/**", "lib/env.ts", "lib/env.server.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throw à l'import hors condition `react-server` (garde-fou
      // build Next.js). En tests `node`, on l'alias vers un no-op pour pouvoir
      // tester `lib/env.server.ts` (#325).
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
});
