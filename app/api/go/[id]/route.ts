/**
 * Route de redirection affiliée — `/api/go/[id]` (issue #111, slice sans-DB).
 *
 * Flux : clic CTA partenaire → `/api/go/<booking_link_id>?src=<ui>` →
 *   1. résout le `booking_link` actif (url + partner + venue_id),
 *   2. décore l'URL partenaire avec les UTM SportHub (cf. lib/affiliate),
 *   3. émet un event analytics best-effort,
 *   4. redirige (302) vers l'URL décorée.
 *
 * Toute anomalie (id invalide, lien introuvable/inactif, erreur DB) → 302 vers
 * l'accueil : un clic utilisateur ne doit jamais aboutir à une page d'erreur.
 *
 * Hors slice (nécessite une migration + table dédiée) : persistance des clics
 * et dashboard partenaire.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  buildAffiliateUrl,
  hashIp,
  clientIpFromHeader,
  normalizePartnerSlug,
} from "@/lib/affiliate";
import { trackEvent, captureException } from "@/lib/monitoring";

// node:crypto (hashIp) → runtime nodejs, pas edge.
export const runtime = "nodejs";
// Lookup DB par requête → rendu dynamique (pas de cache statique).
export const dynamic = "force-dynamic";

/**
 * Sel pour le hash d'IP (RGPD), résolu de façon fail-closed.
 *
 * En production, on EXIGE `IP_HASH_SALT` : sans lui, un sel codé en dur serait
 * public → le hash redeviendrait ré-identifiable par dictionnaire (l'espace
 * IPv4 est petit), ce qui annule l'objectif RGPD. Donc en prod sans variable,
 * on retourne `null` et on stocke `ip_hash = NULL` plutôt qu'un hash faussement
 * anonyme.
 *
 * Hors prod (dev/preview), un fallback connu permet au build et aux previews
 * de fonctionner sans secret.
 */
function resolveIpHashSalt(): string | null {
  const fromEnv = process.env.IP_HASH_SALT;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;
  return "sporthub-dev-ip-salt";
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const home = new URL("/", request.url);

  // Garde-fou : un id de booking_link ressemble à un uuid. Évite les lookups
  // inutiles sur des chemins fantaisistes (bots, scans).
  if (!/^[0-9a-f-]{16,}$/i.test(id)) {
    return NextResponse.redirect(home, 302);
  }

  try {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("booking_link")
      .select("url, partner, venue_id, is_active")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data?.url) {
      return NextResponse.redirect(home, 302);
    }

    const source = request.nextUrl.searchParams.get("src") ?? undefined;
    const target = buildAffiliateUrl(data.url, {
      venueId: data.venue_id ?? "",
      partner: data.partner ?? "",
      source,
    });

    // Métadonnées RGPD-safe du clic : IP hashée (jamais en clair), UA, referer.
    // salt null (prod sans IP_HASH_SALT) → ipHash null (pas de hash à sel public).
    const salt = resolveIpHashSalt();
    const ipHash = salt
      ? hashIp(clientIpFromHeader(request.headers.get("x-forwarded-for")), salt)
      : null;

    // Best-effort : un échec de tracking ne doit pas empêcher la redirection.
    trackEvent("affiliate_click", {
      bookingLinkId: id,
      partner: data.partner,
      venueId: data.venue_id,
      source,
    });

    // Persistance du clic (table affiliate_click, migrations 0011 + 0012 + 0015) —
    // alimente le dashboard /admin/affiliate. Best-effort : on n'attend pas
    // l'insert et on avale toute erreur, la redirection prime sur la télémétrie.
    // `partner_slug` = forme normalisée de `partner`, alignée sur `partner.slug`
    // (#209) → permet de joindre le référentiel sans dépendre du texte libre.
    void sb
      .from("affiliate_click")
      .insert({
        booking_link_id: id,
        partner: data.partner ?? "",
        partner_slug: normalizePartnerSlug(data.partner),
        venue_id: data.venue_id ?? null,
        source: source ?? null,
        ip_hash: ipHash,
        user_agent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
      })
      .then(({ error: insertError }) => {
        if (insertError) {
          captureException(insertError, {
            route: "/api/go/[id]",
            op: "affiliate_click insert",
            id,
          });
        }
      });

    return NextResponse.redirect(target, 302);
  } catch (e) {
    captureException(e, { route: "/api/go/[id]", id });
    return NextResponse.redirect(home, 302);
  }
}
