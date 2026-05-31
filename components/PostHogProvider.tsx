"use client";

/**
 * Provider PostHog client global — monté dans `app/[locale]/layout.tsx`.
 * Issue #96.
 *
 * Gating : ne s'initialise QUE si `NEXT_PUBLIC_POSTHOG_KEY` est présent.
 * Sans clé (dev local, ou prod tant que la clé n'est pas configurée dans
 * Vercel), le provider est un pass-through total → zéro réseau, zéro coût,
 * zéro régression. C'est le même contrat fail-safe que la façade Sentry
 * dans `lib/monitoring.ts`.
 *
 * Privacy-first :
 *   - `person_profiles: "identified_only"` → pas de profil pour les
 *     visiteurs anonymes (RGPD-friendly, on ne crée un profil qu'au login).
 *   - `mask_all_text` / `maskAllInputs` côté session-recording : on ne
 *     l'active pas du tout ici (pas de capture de session par défaut).
 *   - `capture_pageview: false` → on gère le $pageview nous-mêmes au
 *     changement de route App Router (le tracking auto SPA de posthog-js
 *     se base sur l'history API et rate les navigations Next côté client).
 *
 * Action user externe (cf. issue) : créer un projet sur eu.posthog.com,
 * coller la public API key dans `NEXT_PUBLIC_POSTHOG_KEY` (Vercel + .env.local).
 */

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

let initialized = false;

function ensureInitialized() {
  if (initialized || !POSTHOG_KEY || typeof window === "undefined") return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    // On capture les $pageview manuellement (cf. PageviewTracker) car le
    // tracking auto SPA rate les navigations App Router côté client.
    capture_pageview: false,
    capture_pageleave: true,
  });
  initialized = true;
}

/**
 * Émet un $pageview à chaque changement de route (pathname + query).
 * Rendu dans un composant séparé pour pouvoir l'envelopper dans un
 * <Suspense> (useSearchParams force le rendu dynamique sinon).
 */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Pas de clé → pass-through : on ne charge même pas le contexte PostHog.
  if (!POSTHOG_KEY) return <>{children}</>;

  ensureInitialized();

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
