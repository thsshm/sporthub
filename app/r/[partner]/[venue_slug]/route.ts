/**
 * Redirect tracker affilié — GET /r/{partner}/{venue_slug}
 *
 * Issue #111. Point d'entrée unique pour tous les liens sortants vers les
 * plateformes partenaires. Au lieu de linker en direct (sans preuve de trafic),
 * le frontend pointe vers /r/{partner}/{venue_slug} :
 *   1. on lit la ligne `partner` (template d'URL + affiliate_id) ;
 *   2. on construit l'URL finale (template + UTM + affiliate_id) ;
 *   3. on enregistre un `partner_click` (RGPD : ip_hash, jamais l'IP en clair) ;
 *   4. on 302 vers le partenaire.
 *
 * Le tracking ne doit JAMAIS bloquer la redirection : toute erreur d'INSERT est
 * capturée et avalée, l'utilisateur part quand même chez le partenaire.
 *
 * Runtime nodejs : on utilise node:crypto (createHash) pour le hash d'IP.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import {
  buildPartnerRedirectUrl,
  hashIp,
  clientIpFromHeader,
  type PartnerForRedirect,
} from "@/lib/partners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sel pour le hash d'IP (RGPD). Optionnel : un fallback dev permet au build et
// aux previews sans secret de fonctionner. En prod, définir IP_HASH_SALT.
const IP_HASH_SALT = process.env.IP_HASH_SALT ?? "sporthub-dev-ip-salt";

type PartnerClickInsert = {
  partner_slug: string;
  venue_id: string | null;
  venue_slug: string;
  ip_hash: string | null;
  user_agent: string | null;
  referer: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: { partner: string; venue_slug: string } },
) {
  const { partner: partnerSlug, venue_slug: venueSlug } = params;

  const sb = getSupabaseAdminClient();
  // lib/supabase/types.ts (généré) ne connaît pas encore partner/partner_click :
  // la migration 0011 n'est pas appliquée à la DB linkée au moment du build, donc
  // `supabase gen types` ne les a pas régénérées. On caste vers un client non
  // typé pour ces deux tables uniquement. À retirer après régénération post-0011.
  const db = sb as unknown as SupabaseClient;

  // 1) Résout le partenaire (actif). Inconnu → 404 (lien malformé/obsolète).
  const { data: partnerRow } = await db
    .from("partner")
    .select("slug, base_url_template, affiliate_id")
    .eq("slug", partnerSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (!partnerRow) {
    return NextResponse.json(
      { error: `Unknown partner: ${partnerSlug}` },
      { status: 404 },
    );
  }

  // 2) Construit l'URL finale. Un template cassé ne doit pas 500 — 404 propre.
  let finalUrl: string;
  try {
    finalUrl = buildPartnerRedirectUrl(partnerRow as PartnerForRedirect, venueSlug);
  } catch (e) {
    captureException(e, {
      route: "/r/[partner]/[venue_slug]",
      partner: partnerSlug,
      venueSlug,
    });
    return NextResponse.json(
      { error: "Invalid partner URL template" },
      { status: 404 },
    );
  }

  // 3) Tracking — best-effort, ne bloque jamais la redirection.
  try {
    // Résout venue_id depuis le slug (NULL si introuvable : on tracke quand même).
    const { data: venueRow } = await db
      .from("venue")
      .select("id")
      .eq("slug", venueSlug)
      .maybeSingle();

    const ip = clientIpFromHeader(request.headers.get("x-forwarded-for"));
    const click: PartnerClickInsert = {
      partner_slug: partnerSlug,
      venue_id: (venueRow?.id as string | undefined) ?? null,
      venue_slug: venueSlug,
      ip_hash: hashIp(ip, IP_HASH_SALT),
      user_agent: request.headers.get("user-agent"),
      referer: request.headers.get("referer"),
    };

    const { error: insertErr } = await db.from("partner_click").insert(click);
    if (insertErr) throw insertErr;
  } catch (e) {
    // On avale : le tracking ne doit jamais empêcher l'utilisateur de partir.
    captureException(e, {
      route: "/r/[partner]/[venue_slug]",
      partner: partnerSlug,
      venueSlug,
    });
  }

  // 4) 302 (temporaire) — surtout pas 301/308 : Google ne doit pas indexer ni
  //    cacher la redirection (les boutons portent aussi rel="nofollow sponsored").
  return NextResponse.redirect(finalUrl, 302);
}
