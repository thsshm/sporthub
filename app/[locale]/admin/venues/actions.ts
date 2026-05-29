"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin";
import { captureException } from "@/lib/monitoring";
import { venueEditSchema, type VenueEditInput } from "@/lib/venue/edit-schema";

async function updateVenue(
  venueId: string,
  patch: Record<string, unknown>,
  action: string,
) {
  await requireAdmin();
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("venue")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", venueId);
  if (error) {
    captureException(error, { action, venueId });
    throw error;
  }
  revalidatePath("/admin/venues");
}

/**
 * Server Action de l'édition admin (issue #89).
 *
 * Reçoit l'input du form, le valide via Zod, puis met à jour la row Supabase
 * via le client admin (service_role, bypass RLS justifié : on a déjà
 * `requireAdmin()` qui authentifie l'admin via session côté serveur).
 *
 * Retourne `{ ok: false, fieldErrors }` en cas d'échec de validation pour
 * permettre au form client d'afficher les erreurs. En cas de succès,
 * redirige vers `/admin/venues` (via Next `redirect()`).
 */
export type EditVenueState =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof VenueEditInput, string>> }
  | { ok: false; formError: string };

export async function editVenue(
  venueId: string,
  rawInput: unknown,
): Promise<EditVenueState> {
  await requireAdmin();

  const parsed = venueEditSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof VenueEditInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key as keyof VenueEditInput] = issue.message;
      }
    }
    return { ok: false, fieldErrors };
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("venue")
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", venueId)
    .is("deleted_at", null); // refuse l'édition d'une venue soft-deleted

  if (error) {
    captureException(error, { action: "editVenue", venueId });
    return { ok: false, formError: error.message };
  }

  revalidatePath("/admin/venues");
  revalidatePath(`/admin/venues/${venueId}/edit`);
  redirect("/admin/venues");
}

export async function togglePublish(venueId: string, currentValue: boolean) {
  await updateVenue(
    venueId,
    { is_published: !currentValue },
    "togglePublish",
  );
}

export async function softDelete(venueId: string) {
  await updateVenue(
    venueId,
    { deleted_at: new Date().toISOString(), is_published: false },
    "softDelete",
  );
}

export async function restore(venueId: string) {
  await updateVenue(
    venueId,
    { deleted_at: null },
    "restore",
  );
}
