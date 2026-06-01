import type { MetadataRoute } from "next";

/**
 * Web App Manifest (#249) — rend SportHub installable (PWA) sur Chrome/Edge
 * Android + desktop, et « Ajouter à l'écran d'accueil » sur iOS Safari.
 *
 * Next.js sert ce fichier sur /manifest.webmanifest et l'injecte
 * automatiquement via <link rel="manifest"> dans le <head>.
 *
 * start_url=/map?source=pwa : le use case primaire mobile est la carte, pas la
 * home brochure. Le param source=pwa permet de tracker les lancements
 * standalone (analytics).
 *
 * NB : le service worker offline est un follow-up dédié (#249 part 2) — ce
 * manifeste + les icônes + les meta Apple suffisent à l'installabilité sur les
 * navigateurs modernes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SportHub — Carte des spots sportifs",
    short_name: "SportHub",
    description:
      "Trouvez où pratiquer : tennis, padel, surf, yoga, foot et 50+ sports géolocalisés sur la carte mondiale.",
    start_url: "/map?source=pwa",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#2d7a3e",
    categories: ["sports", "navigation", "travel"],
    lang: "fr",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
