/**
 * POST /api/revalidate — revalidation ISR on-demand (flush du cache après une
 * data-op).
 *
 * Pourquoi : les pages SEO sont en ISR `revalidate = 86400` (24 h) et le **Data
 * Cache de Vercel est DURABLE entre déploiements** — une page qui a caché une
 * valeur périmée (ex. un compteur à 0 figé pendant un timeout SQL, cf. bug
 * gym×ville / migration 0058) y reste jusqu'à expiration du TTL OU une
 * revalidation on-demand. Un redeploy ne la purge PAS. Cette route est ce
 * mécanisme : après un backfill / une correction d'index / un refresh de MV, on
 * la déclenche pour refléter le fix en quelques secondes au lieu d'attendre 24 h.
 *
 * Auth : `Authorization: Bearer <secret>` avec `secret` =
 *   - `REVALIDATE_SECRET` si configuré (secret dédié, recommandé) ;
 *   - sinon repli sur `SUPABASE_SERVICE_ROLE_KEY` — déjà présent côté serveur ET
 *     comme secret GitHub Actions, donc la route est utilisable immédiatement
 *     sans config Vercel supplémentaire. La clé n'est jamais loggée ni renvoyée ;
 *     quiconque la détient peut déjà tout faire sur la base, donc l'utiliser
 *     aussi pour autoriser une revalidation n'élargit pas la surface d'attaque.
 *
 * Corps JSON (tout optionnel) :
 *   { "paths":  ["/en/gym/fr/paris", ...],  // revalide ces chemins exacts
 *     "routes": ["/[locale]/[sport]/[country]/[city]", ...] }  // type 'page' :
 *                                            // flush TOUTES les instances du
 *                                            // template dynamique en un appel.
 * Sans corps → flush par défaut des 2 routes SEO programmatiques (sport×ville +
 * page sport). C'est le « gros marteau » : complète tout d'un coup.
 */
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { safeEqual } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Routes SEO programmatiques flushées par défaut (sans corps de requête).
const DEFAULT_ROUTES = [
  "/[locale]/[sport]/[country]/[city]",
  "/[locale]/sports/[sport]",
];

type Body = { paths?: unknown; routes?: unknown };

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Ni REVALIDATE_SECRET ni SUPABASE_SERVICE_ROLE_KEY configuré — refusé." },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // corps vide / non-JSON → on garde les defaults
  }
  const paths = asStringArray(body.paths);
  const routes = body.routes === undefined ? DEFAULT_ROUTES : asStringArray(body.routes);

  for (const p of paths) revalidatePath(p);
  for (const r of routes) revalidatePath(r, "page");

  return NextResponse.json({
    ok: true,
    revalidated: { paths, routes },
    note: paths.length === 0 && routes === DEFAULT_ROUTES
      ? "defaults: routes SEO programmatiques flushées"
      : undefined,
  });
}
