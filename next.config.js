const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Redirects 301 V1 → V2 (cutover Phase 4 — voir MIGRATION.md).
   *
   * Toutes les ~150 URLs HTML statiques de la V1 (sporthubmap.com sur Netlify)
   * doivent rediriger vers la nouvelle structure App Router V2, pour
   * préserver le ranking SEO Google accumulé sur V1.
   *
   * Les patterns dynamiques (:slug, :city) sont supportés par Next.js
   * via path-to-regexp. Ils matchent un segment sans `/`.
   */
  async redirects() {
    return [
      // ── Pages famille (13) ────────────────────────────────────────────
      {
        source: "/family-:slug.html",
        destination: "/sports/:slug",
        permanent: true,
      },

      // ── Pages programmatiques sport × ville ───────────────────────────
      // Slugs FR qui matchent directement le seed sport (padel, tennis, yoga, petanque)
      {
        source: "/padel-:city.html",
        destination: "/padel/fr/:city",
        permanent: true,
      },
      {
        source: "/tennis-:city.html",
        destination: "/tennis/fr/:city",
        permanent: true,
      },
      {
        source: "/yoga-:city.html",
        destination: "/yoga/fr/:city",
        permanent: true,
      },
      {
        source: "/petanque-:city.html",
        destination: "/petanque/fr/:city",
        permanent: true,
      },

      // Slugs FR remappés vers le slug canonique anglais du seed
      // (boxe → boxing, salle-de-sport → gym)
      {
        source: "/boxe-:city.html",
        destination: "/boxing/fr/:city",
        permanent: true,
      },
      {
        source: "/salle-de-sport-:city.html",
        destination: "/gym/fr/:city",
        permanent: true,
      },

      // ── Pages statiques V1 ────────────────────────────────────────────
      { source: "/index.html", destination: "/", permanent: true },
      {
        source: "/academies-de-tennis.html",
        destination: "/sports/tennis",
        permanent: true,
      },

      // Routes V1 sans équivalent V2 → renvoi vers /map (point d'entrée logique)
      { source: "/villes.html", destination: "/map", permanent: true },
      { source: "/explore.html", destination: "/map", permanent: true },

      // Routes internes V1 jamais indexées (mais on garde le redirect au cas où)
      { source: "/dashboard.html", destination: "/", permanent: true },
      { source: "/seo-hotpicks.html", destination: "/", permanent: true },
      { source: "/favoris.html", destination: "/", permanent: true },
    ];
  },

  // Images autorisées depuis Supabase Storage + Wikimedia + Google Places + Mapillary
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
      },
      // Google Places photos (enrichment Google) — issue #127
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      // Mapillary (photos OSM communautaires) — issue #127
      { protocol: "https", hostname: "images.mapillary.com" },
    ],
  },

  // En-têtes sécurité minimaux
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
