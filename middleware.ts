import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip API routes, internal Next assets, auth callbacks, sitemap (root +
  // shards), robots, et tous les fichiers statiques (avec extension).
  // Le pattern `sitemap` (sans .xml) couvre /sitemap ET /sitemap/0..8 — sans
  // ça, le middleware next-intl voyait /sitemap comme `[locale]=sitemap` et
  // produisait un 404 (cf. cause racine #88).
  matcher: [
    "/((?!api|_next|auth|sitemap|robots.txt|favicon|og-image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|js|css|map|woff2?|ttf)).*)",
  ],
};
