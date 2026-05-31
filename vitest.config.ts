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
      exclude: ["lib/**/*.test.ts", "lib/supabase/**", "lib/env.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
