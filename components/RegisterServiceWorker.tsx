"use client";

/**
 * Enregistre le service worker offline (#249 part 2).
 *
 * On n'utilise PAS <SerwistProvider> de @serwist/next/react : sa version 9
 * importe le `compiler-runtime` de React 19, incompatible avec React 18 (la
 * version du projet). Un simple navigator.serviceWorker.register suffit — le
 * SW lui-même est compilé par Serwist (cf. next.config.js → public/sw.js).
 *
 * Uniquement en production : en dev le SW est désactivé (next.config.js) et on
 * évite les soucis de cache.
 */
import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Enregistre après le load pour ne pas concurrencer le chargement initial.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* échec d'enregistrement (contexte non-sécurisé, etc.) → silencieux */
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
