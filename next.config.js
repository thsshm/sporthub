/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prêt à recevoir les redirects 301 V1→V2 — voir MIGRATION.md
  async redirects() {
    return [
      // Exemple de redirect V1 → V2 (à décommenter et compléter au cutover)
      // {
      //   source: "/family-raquette.html",
      //   destination: "/sports/tennis",
      //   permanent: true,
      // },
    ];
  },

  // Images autorisées depuis Supabase Storage + Wikimedia
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

module.exports = nextConfig;
