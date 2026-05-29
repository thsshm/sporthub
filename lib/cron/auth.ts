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

export type CronAuthFailure = {
  response: NextResponse;
};

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
  if (header !== expected) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
  return null;
}
