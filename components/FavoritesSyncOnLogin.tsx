"use client";

/**
 * Watcher client global — sync favoris localStorage → DB au login.
 * Monté dans `app/[locale]/layout.tsx` ; pas d'UI, juste un effet.
 *
 * Pourquoi un composant et pas un hook dans login/page ?
 *   Le flow magic-link est : email → /auth/callback (Server) → redirect /.
 *   Donc la page /login ne voit jamais l'utilisateur connecté ; c'est la
 *   page d'arrivée qui doit déclencher la sync. Le plus propre est un
 *   watcher global sur `onAuthStateChange` qui se déclenche sur
 *   l'événement SIGNED_IN, peu importe sur quelle page on atterrit.
 *
 * Idempotence :
 *   - `syncLocalFavoritesToServer` lit le localStorage, POST chaque entry
 *     (API idempotente côté DB), puis clear si tout passe.
 *   - On marque un flag de session pour éviter de re-tenter à chaque
 *     re-render (mais c'est déjà no-op si le localStorage est vidé).
 *
 * Sentry capture les erreurs réseau côté server via captureException, mais
 * ici on est côté client → on logue console + best-effort, pas critique.
 */

import { useEffect, useRef } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { syncLocalFavoritesToServer } from "@/lib/favorites-sync";

export function FavoritesSyncOnLogin() {
  const syncedRef = useRef(false);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();

    // 1. Si la session existe déjà au mount (user déjà loggué, F5 sur /),
    //    on tente une sync best-effort. No-op si localStorage est vide.
    void (async () => {
      if (syncedRef.current) return;
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (session?.user) {
        syncedRef.current = true;
        try {
          await syncLocalFavoritesToServer();
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[favorites-sync] initial sync failed", err);
          }
        }
      }
    })();

    // 2. Watcher : sur SIGNED_IN (callback OAuth/magic-link → redirect /),
    //    on déclenche la migration des favoris locaux vers la DB.
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      if (syncedRef.current) return;
      syncedRef.current = true;
      void syncLocalFavoritesToServer().catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[favorites-sync] sync after signin failed", err);
        }
      });
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
