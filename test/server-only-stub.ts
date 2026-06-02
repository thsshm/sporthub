// Stub vitest pour le package `server-only`.
//
// `server-only` exporte un module qui THROW à l'import dès qu'on n'est pas dans
// la condition de résolution `react-server` (c'est tout l'intérêt : casser le
// build si un Client Component importe du code serveur). En environnement de
// test `node`, vitest ne pose pas cette condition → l'import réel throw et
// casserait les tests de `lib/env.server.ts`. On l'alias donc vers ce no-op.
export {};
