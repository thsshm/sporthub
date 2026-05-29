import type { MetadataRoute } from "next";

const SITE_URL = "https://sporthubmap.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Pas de chemin admin à crawler
        disallow: ["/admin/", "/api/"],
      },
      // Crawlers IA explicitement autorisés (héritage V1)
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "Claude-Web", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "CCBot", allow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap`,
    host: SITE_URL,
  };
}
