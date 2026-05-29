# Sentry setup — procédure d'activation

État actuel : **dormant**. `lib/monitoring.ts` est une façade no-op qui logge en `console.*` en dev. Cette doc trace la procédure exacte pour activer Sentry quand le besoin se présente (typiquement : trafic régulier + envie de filets de sécurité sur les bugs invisibles).

## Pourquoi pas installé d'avance

- `@sentry/nextjs` ajoute ~50KB au bundle client
- Free tier 5k errors/mois → réservé pour quand on a du vrai trafic
- Le wiring nécessite un compte sentry.io existant (créé au moment de l'activation)
- Les logs Vercel sont suffisants pour debugger en attendant (consultables via `vercel.com/<project>/<deployment>/functions`)

## Procédure d'activation (10 min)

### 1. Créer le compte + projet Sentry

1. Aller sur https://sentry.io → "Sign up" (gratuit, free tier 5k events/mois)
2. Créer un projet → choisir **Next.js**
3. Copier le **DSN** affiché (format `https://xxx@xxx.ingest.sentry.io/xxx`)

### 2. Configurer les variables d'env Vercel

Vercel project → Settings → Environment Variables :

```
SENTRY_DSN              = <DSN copié au step 1>
NEXT_PUBLIC_SENTRY_DSN  = <même valeur, utilisée côté client>
```

(Optionnel — pour upload automatique des source maps à chaque build :)

```
SENTRY_ORG              = <ton-org-slug>
SENTRY_PROJECT          = <ton-project-slug>
SENTRY_AUTH_TOKEN       = <internal-integration-token>
```

Le token s'obtient sur Sentry → Settings → Auth Tokens → Create New Token → scope `project:releases`.

### 3. Installer @sentry/nextjs

```bash
pnpm add @sentry/nextjs
```

### 4. Créer les configs

Trois fichiers à la racine du repo :

#### `sentry.client.config.ts`

```ts
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
  });
}
```

#### `sentry.server.config.ts`

```ts
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}
```

#### `sentry.edge.config.ts`

```ts
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}
```

#### `instrumentation.ts`

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(err, {
    tags: {
      path: request.path,
      method: request.method,
      routeType: context.routeType,
    },
    extra: { routePath: context.routePath },
  });
}
```

### 5. Activer dans `next.config.js`

Wrapper avec `withSentryConfig` qui upload les sourcemaps au build :

```js
const { withSentryConfig } = require("@sentry/nextjs");

const sentryEnabled = !!(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
);

const baseConfig = withNextIntl(nextConfig);
module.exports = sentryEnabled
  ? withSentryConfig(baseConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
      tunnelRoute: "/monitoring-tunnel", // évite ad-blockers
    })
  : baseConfig;
```

### 6. Remplacer le stub dans `lib/monitoring.ts`

Dans la fonction `captureException`, remplacer le commentaire stub par :

```ts
if (sentryEnabled) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.captureException(error, { extra: context });
  });
}
```

### 7. Tester

```bash
# Local
pnpm dev
# Visiter http://localhost:3000/api/monitoring/sentry-test
# → l'erreur doit apparaître sur sentry.io en < 1 min

# Prod (après deploy Vercel)
curl https://sporthubmap.com/api/monitoring/sentry-test
# → idem, vérifier que la release tag = commit SHA Vercel
```

## Comportement attendu après activation

- Toutes les `captureException()` server-side → Sentry avec release (commit SHA), env (preview/production), et le contexte fourni en tags.
- Erreurs client (uncaught + promise rejections) → captées automatiquement par `sentry.client.config.ts`.
- Replay : 1% des sessions normales, 100% des sessions où une erreur s'est produite (RGPD-safe : `maskAllText` + `blockAllMedia`).
- Sourcemaps uploadés au build → stack traces lisibles dans Sentry (pas le bundle minifié).

## Alternative au wiring manuel

Au lieu de coller les configs ci-dessus à la main, tu peux lancer le wizard officiel qui les génère et configure pour toi :

```bash
npx @sentry/wizard@latest -i nextjs
```

Il pose les questions (DSN, org, project) et écrit les bons fichiers automatiquement.
