import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip API routes, internal Next assets, auth callbacks, sitemap, robots,
  // et tous les fichiers statiques (avec extension)
  matcher: [
    "/((?!api|_next|auth|sitemap.xml|robots.txt|favicon|og-image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|js|css|map|woff2?|ttf)).*)",
  ],
};
