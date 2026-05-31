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
import { buildAffiliateUrl } from "@/lib/affiliate";
import { trackEvent, captureException } from "@/lib/monitoring";

// Lookup DB par requête → rendu dynamique (pas de cache statique).
export const dynamic = "force-dynamic";

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

    // Best-effort : un échec de tracking ne doit pas empêcher la redirection.
    trackEvent("affiliate_click", {
      bookingLinkId: id,
      partner: data.partner,
      venueId: data.venue_id,
      source,
    });

    return NextResponse.redirect(target, 302);
  } catch (e) {
    captureException(e, { route: "/api/go/[id]", id });
    return NextResponse.redirect(home, 302);
  }
}
