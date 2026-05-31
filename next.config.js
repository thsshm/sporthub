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
      // Pour les family slugs qui SONT déjà des sport slugs (yoga), le pattern
      // générique ci-dessous suffit. Pour les autres (raquette, ballon, etc.),
      // on redirige vers le premier sport de la famille pour éviter le 404
      // (cf. #176 — /sports/raquette renvoyait 404 car aucun "raquette" en
      // table `sport`, seulement "tennis", "padel", etc.).
      {
        source: "/family-:slug.html",
        destination: "/sports/:slug",
        permanent: true,
      },

      // ── /sports/{family} → /sports/{premier-sport-de-la-famille} ─────
      // Cf. issue #176. Le slug "yoga" est skip car déjà un sport slug valide.
      { source: "/sports/raquette",  destination: "/sports/tennis",       permanent: true },
      { source: "/sports/ballon",    destination: "/sports/football",     permanent: true },
      { source: "/sports/fitness",   destination: "/sports/gym",          permanent: true },
      { source: "/sports/combat",    destination: "/sports/boxing",       permanent: true },
      { source: "/sports/baignade",  destination: "/sports/beach",        permanent: true },
      { source: "/sports/boules",    destination: "/sports/petanque",     permanent: true },
      { source: "/sports/nautique",  destination: "/sports/marina",       permanent: true },
      { source: "/sports/glisse",    destination: "/sports/surf",         permanent: true },
      { source: "/sports/snow",      destination: "/sports/skiing",       permanent: true },
      { source: "/sports/hike",      destination: "/sports/trail",        permanent: true },
      { source: "/sports/retraites", destination: "/sports/yoga_retreat", permanent: true },
      { source: "/sports/plus",      destination: "/sports/golf",         permanent: true },
      // Idem variantes avec préfixe locale i18n /fr /en /zh
      { source: "/fr/sports/raquette",  destination: "/sports/tennis",       permanent: true },
      { source: "/fr/sports/ballon",    destination: "/sports/football",     permanent: true },
      { source: "/fr/sports/fitness",   destination: "/sports/gym",          permanent: true },
      { source: "/fr/sports/combat",    destination: "/sports/boxing",       permanent: true },
      { source: "/fr/sports/baignade",  destination: "/sports/beach",        permanent: true },
      { source: "/fr/sports/boules",    destination: "/sports/petanque",     permanent: true },
      { source: "/fr/sports/nautique",  destination: "/sports/marina",       permanent: true },
      { source: "/fr/sports/glisse",    destination: "/sports/surf",         permanent: true },
      { source: "/fr/sports/snow",      destination: "/sports/skiing",       permanent: true },
      { source: "/fr/sports/hike",      destination: "/sports/trail",        permanent: true },
      { source: "/fr/sports/retraites", destination: "/sports/yoga_retreat", permanent: true },
      { source: "/fr/sports/plus",      destination: "/sports/golf",         permanent: true },
      { source: "/en/sports/raquette",  destination: "/en/sports/tennis",       permanent: true },
      { source: "/en/sports/ballon",    destination: "/en/sports/football",     permanent: true },
      { source: "/en/sports/fitness",   destination: "/en/sports/gym",          permanent: true },
      { source: "/en/sports/combat",    destination: "/en/sports/boxing",       permanent: true },
      { source: "/en/sports/baignade",  destination: "/en/sports/beach",        permanent: true },
      { source: "/en/sports/boules",    destination: "/en/sports/petanque",     permanent: true },
      { source: "/en/sports/nautique",  destination: "/en/sports/marina",       permanent: true },
      { source: "/en/sports/glisse",    destination: "/en/sports/surf",         permanent: true },
      { source: "/en/sports/snow",      destination: "/en/sports/skiing",       permanent: true },
      { source: "/en/sports/hike",      destination: "/en/sports/trail",        permanent: true },
      { source: "/en/sports/retraites", destination: "/en/sports/yoga_retreat", permanent: true },
      { source: "/en/sports/plus",      destination: "/en/sports/golf",         permanent: true },
      { source: "/zh/sports/raquette",  destination: "/zh/sports/tennis",       permanent: true },
      { source: "/zh/sports/ballon",    destination: "/zh/sports/football",     permanent: true },
      { source: "/zh/sports/fitness",   destination: "/zh/sports/gym",          permanent: true },
      { source: "/zh/sports/combat",    destination: "/zh/sports/boxing",       permanent: true },
      { source: "/zh/sports/baignade",  destination: "/zh/sports/beach",        permanent: true },
      { source: "/zh/sports/boules",    destination: "/zh/sports/petanque",     permanent: true },
      { source: "/zh/sports/nautique",  destination: "/zh/sports/marina",       permanent: true },
      { source: "/zh/sports/glisse",    destination: "/zh/sports/surf",         permanent: true },
      { source: "/zh/sports/snow",      destination: "/zh/sports/skiing",       permanent: true },
      { source: "/zh/sports/hike",      destination: "/zh/sports/trail",        permanent: true },
      { source: "/zh/sports/retraites", destination: "/zh/sports/yoga_retreat", permanent: true },
      { source: "/zh/sports/plus",      destination: "/zh/sports/golf",         permanent: true },

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
      // Fusion /explore → /map (#132). Variantes V2 bare + préfixes locale.
      // La V1 servait /explore.html ; on couvre aussi /explore sans extension
      // au cas où un backlink pointe vers la forme "propre".
      { source: "/explore", destination: "/map", permanent: true },
      { source: "/fr/explore", destination: "/map", permanent: true },
      { source: "/en/explore", destination: "/en/map", permanent: true },
      { source: "/zh/explore", destination: "/zh/map", permanent: true },

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
