import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip API routes, internal Next assets, auth callbacks, sitemap (root +
  // shards), robots, les images de metadata Next (opengraph-image /
  // twitter-image), et tous les fichiers statiques (avec extension).
  // Le pattern `sitemap` (sans .xml) couvre /sitemap ET /sitemap/0..8 — sans
  // ça, le middleware next-intl voyait /sitemap comme `[locale]=sitemap` et
  // produisait un 404 (cf. cause racine #88).
  // `.*opengraph-image` / `.*twitter-image` : ces routes file-convention sont
  // générées sous /[locale]/… → le middleware redirigeait /fr/…/opengraph-image
  // (307, strip du préfixe locale par défaut), donc la balise og:image pointait
  // vers une URL qui redirige. En les excluant, /fr/…/opengraph-image est servi
  // 200 direct (ces routes lisent leur locale via params, pas via next-intl).
  // Cf. #222.
  matcher: [
    // Exclut : API, assets Next, auth, sitemap, robots.txt, favicon, og-image,
    // opengraph/twitter-image, manifest.webmanifest (#413 — sans cette
    // exclusion next-intl interprète /manifest.webmanifest comme une route de
    // locale → 404), et tous les fichiers statiques avec extension.
    "/((?!api|_next|auth|sitemap|robots.txt|favicon|manifest.webmanifest|og-image|.*opengraph-image|.*twitter-image|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|js|css|map|woff2?|ttf)).*)",
  ],
};
