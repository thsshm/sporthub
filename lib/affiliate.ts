/**
 * Tracking affilié — construction des URLs sortantes (#111, slice sans-DB).
 *
 * Quand un utilisateur clique sur un lien de réservation partenaire, on passe
 * par la route `/api/go/[id]` qui :
 *   1. résout le `booking_link` (url + partner) depuis Supabase,
 *   2. décore l'URL partenaire avec des paramètres UTM (attribution),
 *   3. émet un event analytics (`trackEvent`),
 *   4. redirige (302) vers l'URL décorée.
 *
 * Ce module ne contient QUE de la logique pure (décoration d'URL + hash RGPD) —
 * testable sans réseau ni DB. La persistance des clics vit dans la table
 * `affiliate_click` (migrations 0011 + 0012), alimentée par la route.
 */
import { createHash } from "node:crypto";

export type AffiliateContext = {
  /** Identifiant du venue (pour l'attribution analytics + utm_term). */
  venueId: string;
  /** Nom du partenaire (Doctolib, Anybuddy, etc.) → utm_content. */
  partner: string;
  /** Origine du clic dans l'UI (ex. "venue_page", "map_popup"). */
  source?: string;
};

/** Valeurs UTM par défaut pour tous les liens affiliés sortants. */
export const AFFILIATE_UTM = {
  source: "sporthubmap",
  medium: "referral",
  campaign: "venue_booking",
} as const;

/**
 * Décore une URL partenaire avec les paramètres UTM d'attribution SportHub.
 *
 * Règles :
 *   - N'écrase jamais un `utm_*` déjà présent dans l'URL (le partenaire peut
 *     avoir ses propres campagnes — on respecte sa source de vérité).
 *   - Préserve les query params et le fragment existants.
 *   - `utm_content` = partner, `utm_term` = venueId, `utm_source/medium/campaign`
 *     = constantes SportHub. `shub_src` = source UI si fournie.
 *   - URL invalide (non absolue / malformée) → renvoyée telle quelle (la route
 *     redirigera quand même, sans casser sur une donnée partenaire douteuse).
 */
export function buildAffiliateUrl(rawUrl: string, ctx: AffiliateContext): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const setIfAbsent = (key: string, value: string) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  };

  setIfAbsent("utm_source", AFFILIATE_UTM.source);
  setIfAbsent("utm_medium", AFFILIATE_UTM.medium);
  setIfAbsent("utm_campaign", AFFILIATE_UTM.campaign);
  setIfAbsent("utm_content", ctx.partner);
  setIfAbsent("utm_term", ctx.venueId);
  if (ctx.source) setIfAbsent("shub_src", ctx.source);

  return url.toString();
}

/**
 * Hash SHA-256 d'une IP avec un sel, pour un stockage RGPD-safe dans
 * `affiliate_click.ip_hash`. Le sel rend le hash non ré-identifiable par
 * dictionnaire (l'espace IPv4 est petit : 2³² → brute-forçable sans sel).
 *
 * Retourne `null` si l'IP est absente, pour insérer NULL plutôt qu'un hash
 * de chaîne vide. (Repris de l'approche de la PR #202.)
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
