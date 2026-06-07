/**
 * Proxy same-origin des tuiles du fond de carte (#430).
 *
 * Problème : MapLibre charge les tuiles raster avec `crossOrigin="anonymous"`
 * (obligatoire pour les uploader en texture WebGL). Sur certains réseaux clients,
 * l'en-tête `Access-Control-Allow-Origin` de cartocdn est retiré (proxy/VPN/DNS),
 * ou les sous-domaines `a/b/c/d.basemaps.cartocdn.com` sont filtrés → la tuile
 * n'est jamais peinte → fond de carte blanc (les pins HTML, eux, s'affichent).
 *
 * Fix : on sert les tuiles depuis NOTRE domaine. Same-origin ⇒ aucune dépendance
 * au CORS ni aux sous-domaines tiers. Le client atteint déjà ce domaine (l'app
 * s'y charge), donc c'est robuste contre ce type de réseau.
 *
 * Sécurité : coordonnées validées strictement (entiers bornés par le zoom) pour
 * ne pas exposer un proxy ouvert (SSRF). Cache agressif → le CDN Vercel sert la
 * quasi-totalité des tuiles, bande passante origin minime.
 */
export const runtime = "edge";

const UPSTREAM = "https://a.basemaps.cartocdn.com/rastertiles/voyager";

/** Entier décimal borné [0, max], sinon null. */
function intInRange(raw: string, max: number): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

export async function GET(
  _req: Request,
  { params }: { params: { z: string; x: string; y: string } }
): Promise<Response> {
  const z = intInRange(params.z, 22);
  if (z === null) return new Response("Bad zoom", { status: 400 });

  const max = 2 ** z - 1;
  const x = intInRange(params.x, max);
  // Le template MapLibre passe `{y}` sans extension ; on tolère un `.png` final.
  const y = intInRange(params.y.replace(/\.png$/, ""), max);
  if (x === null || y === null) {
    return new Response("Bad tile coordinates", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": "SportHub/1.0 (+https://sporthubmap.com)" },
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Tile unavailable", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=2592000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
