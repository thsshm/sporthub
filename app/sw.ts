/**
 * Service Worker SportHub (#249 part 2) — offline shell + runtime caching.
 *
 * Compilé par @serwist/next (cf. next.config.js) vers public/sw.js au build.
 * `self.__SW_MANIFEST` est injecté par Serwist avec les assets à précacher
 * (shell HTML + JS/CSS statiques).
 *
 * Stratégies de cache runtime (cf. issue #249) :
 *   - tuiles MapLibre (cartocdn)      : StaleWhileRevalidate, 7 j
 *   - /api/venues?bbox=…              : NetworkFirst (fallback cache), 1 h
 *   - photos Wikimedia                : CacheFirst, 30 j
 *   - reste : defaultCache de @serwist/next (pages, _next, etc.)
 *
 * On NE précache PAS les 347k venues (follow-up dédié, cf. #226 PMTiles).
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY = 24 * 60 * 60;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Tuiles MapLibre (basemaps CartoCDN) — change rarement, on sert vite.
    {
      matcher: ({ url }) => url.hostname.endsWith("basemaps.cartocdn.com"),
      handler: new StaleWhileRevalidate({
        cacheName: "map-tiles",
        plugins: [
          new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * DAY }),
        ],
      }),
    },
    // /api/venues — données fraîches d'abord, cache en secours hors-ligne.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/api/venues"),
      handler: new NetworkFirst({
        cacheName: "api-venues",
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 1 * DAY }),
        ],
      }),
    },
    // Photos Wikimedia — immuables, cache-first longue durée.
    {
      matcher: ({ url }) =>
        url.hostname === "upload.wikimedia.org" ||
        url.hostname === "commons.wikimedia.org",
      handler: new CacheFirst({
        cacheName: "wikimedia-photos",
        plugins: [
          new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY }),
        ],
      }),
    },
    // Le reste (pages, _next/static, fonts…) : stratégies par défaut Next.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
