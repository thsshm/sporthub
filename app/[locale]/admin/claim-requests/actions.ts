"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { sendClaimResolutionEmail } from "@/lib/email/send-claim-resolution";
import { captureException } from "@/lib/monitoring";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Server Actions de modération des demandes de claim (issue #90).
 *
 * Workflow :
 *   1. requireAdmin() — vérifie la session admin
 *   2. Valider l'input via Zod (claimId UUID + note <= 2000 chars)
 *   3. Charger la claim (vérifier statut `pending` pour éviter les rejeux)
 *   4. UPDATE claim_request : status, notes, reviewed_at, reviewed_by
 *      (NB: le schéma 0001 utilise `notes` / `reviewed_at`, pas
 *      `admin_note` / `resolved_at` — on suit le schéma existant.)
 *   5. Si approve : UPDATE venue.claimed_by + venue.claim_status = 'verified'
 *      Service_role nécessaire ici : la policy RLS UPDATE venue ne couvre
 *      que le `claimed_by` existant — un admin doit pouvoir SET ce champ
 *      via service_role (justifié par requireAdmin() côté app).
 *   6. Envoi de l'email au requester (stub, log console).
 *   7. revalidatePath('/admin/claim-requests')
 */

const MAX_NOTE_LEN = 2000;

const resolveClaimSchema = z.object({
  claimId: z.string().uuid({ message: "invalid_claim_id" }),
  adminNote: z
    .string()
    .max(MAX_NOTE_LEN, "note_too_long")
    .transform((v) => v.trim())
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type ResolveClaimState =
  | { ok: true }
  | { ok: false; error: string };

type ClaimRow = {
  id: string;
  venue_id: string;
  requester_user_id: string | null;
  requester_email: string;
  status: string;
  venue:
    | { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
    | null;
};

async function loadClaim(claimId: string): Promise<{
  id: string;
  venueId: string;
  requesterUserId: string | null;
  requesterEmail: string;
  status: string;
  venue: { id: string; name: string; slug: string } | null;
} | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("claim_request")
    .select(
      "id, venue_id, requester_user_id, requester_email, status, venue:venue_id ( id, name, slug )",
    )
    .eq("id", claimId)
    .maybeSingle<ClaimRow>();

  if (error) {
    captureException(error, { action: "loadClaim", claimId });
    throw error;
  }
  if (!data) return null;
  const venue = Array.isArray(data.venue) ? (data.venue[0] ?? null) : data.venue;
  return {
    id: data.id,
    venueId: data.venue_id,
    requesterUserId: data.requester_user_id,
    requesterEmail: data.requester_email,
    status: data.status,
    venue,
  };
}

async function resolveClaim(
  rawInput: unknown,
  decision: "approved" | "rejected",
): Promise<ResolveClaimState> {
  await requireAdmin();

  const parsed = resolveClaimSchema.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "invalid_input";
    return { ok: false, error: msg };
  }
  const { claimId, adminNote } = parsed.data;

  const claim = await loadClaim(claimId);
  if (!claim) return { ok: false, error: "claim_not_found" };
  if (claim.status !== "pending") {
    // Empêche un double-clic ou un rejeu d'une claim déjà traitée
    return { ok: false, error: "claim_already_resolved" };
  }

  const admin = getSupabaseAdminClient();
  const reviewer = await requireAdmin(); // double-check + récupère l'admin.id

  const { error: claimErr } = await admin
    .from("claim_request")
    .update({
      status: decision,
      notes: adminNote,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer.id,
    })
    .eq("id", claimId)
    .eq("status", "pending"); // garde-fou : ne reprocess pas si déjà résolu

  if (claimErr) {
    captureException(claimErr, { action: "resolveClaim", claimId, decision });
    return { ok: false, error: "db_update_claim_failed" };
  }

  if (decision === "approved") {
    // UPDATE venue.claimed_by via service_role : justifié car la policy RLS
    // existante (cf. 0001_initial_schema.sql) ne permet UPDATE qu'au
    // claimed_by déjà set. Un admin doit pouvoir attribuer ce champ.
    if (claim.requesterUserId) {
      const { error: venueErr } = await admin
        .from("venue")
        .update({
          claimed_by: claim.requesterUserId,
          claim_status: "verified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.venueId);
      if (venueErr) {
        captureException(venueErr, {
          action: "resolveClaim.setVenueClaimedBy",
          claimId,
          venueId: claim.venueId,
        });
        return { ok: false, error: "db_update_venue_failed" };
      }
    } else {
      // Cas limite : claim créée avant signup (requester_user_id NULL).
      // On approuve quand même la claim mais on ne peut pas SET claimed_by.
      captureException(
        new Error("approved claim without requester_user_id"),
        { claimId },
      );
    }
  }

  if (claim.venue) {
    await sendClaimResolutionEmail({
      to: claim.requesterEmail,
      type: decision === "approved" ? "approve" : "reject",
      venue: { name: claim.venue.name, slug: claim.venue.slug },
      adminNote,
    });
  }

  revalidatePath("/admin/claim-requests");
  return { ok: true };
}

export async function approveClaim(
  rawInput: unknown,
): Promise<ResolveClaimState> {
  return resolveClaim(rawInput, "approved");
}

export async function rejectClaim(
  rawInput: unknown,
): Promise<ResolveClaimState> {
  return resolveClaim(rawInput, "rejected");
}
