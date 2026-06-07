/**
 * /api/basemap/[z]/[x]/[y] — proxy same-origin des tuiles raster du fond de
 * carte (#430).
 *
 * Pourquoi : MapLibre charge les tuiles avec `crossOrigin="anonymous"` ; une
 * image cross-origin ne devient une texture WebGL que si la réponse porte
 * `Access-Control-Allow-Origin`. Sur certains réseaux (proxy/VPN/DNS d'entreprise
 * ou de FAI), soit ce header CORS est retiré, soit les sous-domaines
 * `a/b/c/d.basemaps.cartocdn.com` sont filtrés → tuiles jamais peintes → fond
 * blanc (les pins HTML restent OK). Reproduit sur le réseau du propriétaire.
 *
 * En servant les tuiles depuis NOTRE domaine (same-origin), il n'y a plus de
 * CORS ni de dépendance aux sous-domaines tiers : le client atteint déjà notre
 * domaine (l'app s'y charge), donc robuste contre ce type de réseau.
 *
 * Coût maîtrisé : `Cache-Control` long → la quasi-totalité des tuiles est servie
 * par le CDN Vercel (s-maxage), pas par la fonction edge.
 */
export const runtime = "edge";

const UPSTREAM = "https://basemaps.cartocdn.com/rastertiles/voyager";
// Tuiles raster immuables (un (z,x,y) ne change jamais de rendu).
const CACHE = "public, max-age=86400, s-maxage=604800, immutable";

export async function GET(
  _req: Request,
  { params }: { params: { z: string; x: string; y: string } },
) {
  const { z, x, y } = params;
  // Anti-abus / SSRF : uniquement des entiers de coordonnées de tuile.
  if (![z, x, y].every((v) => /^\d{1,7}$/.test(v))) {
    return new Response("Bad tile coordinates", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
      headers: { Accept: "image/png" },
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) {
    return new Response("Tile not found", { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": CACHE,
    },
  });
}
