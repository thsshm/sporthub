/**
 * Auth pour les Route Handlers `app/api/cron/*`.
 *
 * Vercel cron injecte automatiquement le header
 * `Authorization: Bearer <CRON_SECRET>` quand la variable d'env `CRON_SECRET`
 * est configurée côté projet — c'est le mécanisme officiel pour empêcher
 * qu'un tiers déclenche les crons depuis internet
 * (cf. https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 *
 * Le helper renvoie `null` si l'auth est OK (cas nominal — la route continue),
 * ou un `NextResponse` 401/500 prêt à renvoyer si le check échoue.
 *
 * En dev local, `CRON_SECRET` peut être absent (`.env.local` n'a pas la
 * variable) — dans ce cas on rejette TOUTES les requêtes en 500 pour ne pas
 * exposer un endpoint cron sans secret.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export type CronAuthFailure = {
  response: NextResponse;
};

/**
 * Comparaison de chaînes à temps constant (anti timing-attack).
 *
 * `a !== b` court-circuite au premier octet différent → le temps de réponse
 * fuit la longueur du préfixe commun, ce qui permet (en théorie) de
 * reconstruire un secret octet par octet. `crypto.timingSafeEqual` compare en
 * temps constant, mais exige des Buffers de MÊME longueur — sinon il throw.
 *
 * On gère ça en deux temps :
 *   1. compare les longueurs en premier (une différence de longueur n'est pas
 *      un secret exploitable) ;
 *   2. si égales, compare le contenu à temps constant.
 * Exportée pour être testable unitairement.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Vérifie le header `Authorization: Bearer <CRON_SECRET>`.
 * Retourne `null` si OK, sinon un objet `{ response }` à renvoyer tel quel.
 */
export function verifyCronAuth(request: Request): CronAuthFailure | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return {
      response: NextResponse.json(
        {
          error:
            "CRON_SECRET non configuré côté serveur — endpoint refusé par sécurité.",
        },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!safeEqual(header, expected)) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
  return null;
}
