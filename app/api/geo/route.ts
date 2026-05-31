/**
 * GET /api/geo — géolocalisation approximative (ville) du visiteur par IP.
 *
 * Lit les headers edge injectés par Vercel (`x-vercel-ip-*`) et renvoie
 * `{ lat, lon, city, country }`, ou `{ geo: null }` si indisponible (dev local,
 * IP non géolocalisable). Aucune API tierce, aucun stockage : la position n'est
 * jamais persistée — juste relayée au client pour centrer la carte.
 *
 * Consommé par MapWithSearch au mount de /map pour un recentrage instantané
 * sans permission, complété par la géoloc navigateur précise (#214).
 *
 * Runtime edge : on ne fait que lire des headers → latence minimale.
 */
import { NextResponse } from "next/server";
import { parseVercelGeo } from "@/lib/ip-geo";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const geo = parseVercelGeo((name) => request.headers.get(name));
  return NextResponse.json(
    { geo },
    {
      headers: {
        // Privé (lié à l'IP du visiteur, jamais partagé entre users) + court
        // cache navigateur pour éviter un appel par navigation interne.
        "Cache-Control": "private, max-age=600",
      },
    },
  );
}
