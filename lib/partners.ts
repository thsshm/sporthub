/**
 * Tracking affilié — construction des URLs de redirection partenaire.
 *
 * Issue #111. Le route handler `app/r/[partner]/[venue_slug]/route.ts` lit la
 * ligne `partner` en DB, appelle `buildPartnerRedirectUrl` pour produire l'URL
 * finale (template + affiliate_id + UTM), enregistre un `partner_click`, puis
 * 302 vers cette URL.
 *
 * Logique volontairement pure (aucun accès DB / réseau) → testable unitairement.
 */
import { createHash } from "node:crypto";

/** Sous-ensemble de la table `partner` nécessaire à la construction d'URL. */
export type PartnerForRedirect = {
  slug: string;
  base_url_template: string;
  affiliate_id: string | null;
};

const UTM_SOURCE = "sporthub";
const UTM_MEDIUM = "referral";

/**
 * Construit l'URL finale vers le partenaire.
 *
 * 1. Substitue les placeholders du template :
 *      `{slug}`         → slug de la venue (URL-encodé)
 *      `{affiliate_id}` → affiliate_id du partenaire, ou "" si non signé
 * 2. Ajoute les paramètres UTM en préservant la query string existante du
 *    template (on n'écrase pas un `?q=` déjà présent) :
 *      utm_source=sporthub
 *      utm_medium=referral
 *      utm_campaign={partner_slug}
 *      utm_content={venue_slug}
 *
 * @throws si le template (après substitution) n'est pas une URL absolue valide.
 */
export function buildPartnerRedirectUrl(
  partner: PartnerForRedirect,
  venueSlug: string,
): string {
  const substituted = partner.base_url_template
    .replaceAll("{slug}", encodeURIComponent(venueSlug))
    .replaceAll("{affiliate_id}", partner.affiliate_id ?? "");

  // `new URL` valide l'absolu (protocole + host) et préserve la query existante.
  const url = new URL(substituted);
  // set() écrase une éventuelle clé utm_* déjà présente (idempotent), append sinon.
  url.searchParams.set("utm_source", UTM_SOURCE);
  url.searchParams.set("utm_medium", UTM_MEDIUM);
  url.searchParams.set("utm_campaign", partner.slug);
  url.searchParams.set("utm_content", venueSlug);

  return url.toString();
}

/**
 * Hash SHA-256 d'une IP avec un sel, pour le stockage RGPD-safe dans
 * `partner_click.ip_hash`. Le sel rend le hash non ré-identifiable par
 * dictionnaire (l'espace des IPv4 est petit : 2³² → brute-forçable sans sel).
 *
 * Retourne `null` si l'IP est absente (clic sans `x-forwarded-for`), pour
 * insérer NULL plutôt qu'un hash de chaîne vide.
 */
export function hashIp(ip: string | null | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${ip}${salt}`).digest("hex");
}

/**
 * Extrait la première IP d'un header `x-forwarded-for` (format
 * "client, proxy1, proxy2"). Retourne `null` si absent/vide.
 */
export function clientIpFromHeader(forwardedFor: string | null): string | null {
  if (!forwardedFor) return null;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || null;
}
