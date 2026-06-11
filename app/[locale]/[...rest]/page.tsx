import { notFound } from "next/navigation";

/**
 * Catch-all des URLs inconnues sous /[locale] (#655).
 *
 * Sans cette route, une URL qui ne matche AUCUN segment (ex. /en/blabla) ne
 * passe par aucun `notFound()` applicatif : Next.js rend alors son 404 par
 * défaut dans le layout RACINE (pass-through, sans Nav/Footer/i18n) → page
 * complètement nue (vécu : 404 « blank », zéro navigation).
 *
 * Ce catch-all force ces URLs à traverser le layout [locale] puis à déclencher
 * `notFound()` → c'est `app/[locale]/not-found.tsx` (Nav + Footer + i18n +
 * noindex) qui rend. Les routes plus spécifiques (statiques ou dynamiques,
 * ex. /[sport]/[country]/[city]) gardent la priorité sur le catch-all : ce
 * fichier ne reçoit QUE ce qui n'a matché nulle part ailleurs.
 */
export default function CatchAllNotFound() {
  notFound();
}
