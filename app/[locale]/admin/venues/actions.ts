"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin";
import { captureException } from "@/lib/monitoring";

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
