import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Réconciliation soft-unpublish pour les crons scrapers (#399).
 *
 * Après chaque run d'upsert (refresh-diving, refresh-hyrox, etc.), appeler
 * `softUnpublishMissing` pour désactiver les venues de cette source qui
 * n'ont pas été vus dans le run courant.
 *
 * Garde-plancher obligatoire : si le run a ramené moins de `minRowsFraction`
 * (défaut 0.9 = 90 %) du dernier count connu, on suspecte un fetch partiel
 * (ex. 429 Overpass, timeout réseau) et on ne désactive rien.
 * C'est le piège V1 (2026-06-07) : un 429 avait amené diving 7400→5687 et
 * aurait dépublié 24 % de la base si le garde n'avait pas été là.
 *
 * Paramètres :
 *   sb            — client Supabase admin (service_role)
 *   source        — valeur de venue.source (ex. 'osm', 'res')
 *   runStart      — Date du début du run (avant le premier upsert)
 *   rowsUpserted  — nombre de venues effectivement upsertées dans ce run
 *   minRowsFraction — seuil plancher (défaut 0.9)
 *
 * Retourne { unpublished, skipped, reason }.
 */
export type SoftUnpublishResult = {
  unpublished: number;
  skipped: boolean;
  reason: string;
};

export async function softUnpublishMissing(
  sb: SupabaseClient,
  source: string,
  runStart: Date,
  rowsUpserted: number,
  minRowsFraction = 0.9,
): Promise<SoftUnpublishResult> {
  // 1. Compte le total de venues publiées de cette source AVANT le run
  //    (approximation : ce qu'on avait avant de poster la mise à jour).
  //    On utilise count=planned pour éviter un statement_timeout.
  const { count: prevCount, error: countErr } = await sb
    .from("venue")
    .select("id", { count: "planned", head: true })
    .eq("source", source)
    .eq("is_published", true)
    .is("deleted_at", null);

  if (countErr || prevCount === null) {
    return {
      unpublished: 0,
      skipped: true,
      reason: `count error: ${countErr?.message ?? "null count"}`,
    };
  }

  // 2. Garde-plancher : si le run a ramené < minRowsFraction des venues
  //    connues, on suspecte un fetch partiel → ne pas désactiver.
  const threshold = Math.floor(prevCount * minRowsFraction);
  if (rowsUpserted < threshold) {
    return {
      unpublished: 0,
      skipped: true,
      reason: `garde-plancher : ${rowsUpserted} upserted < ${threshold} (${Math.round(minRowsFraction * 100)}% de ${prevCount})`,
    };
  }

  // 3. Soft-unpublish les venues de cette source avec last_seen_at < runStart.
  //    Ces venues n'ont PAS été vues dans ce run → probablement supprimées de
  //    la source.
  const { count: unpublished, error: upErr } = await sb
    .from("venue")
    .update({ is_published: false })
    .eq("source", source)
    .eq("is_published", true)
    .is("deleted_at", null)
    .lt("last_seen_at", runStart.toISOString())
    .not("last_seen_at", "is", null); // ne touche que les venues trackées

  if (upErr) {
    return {
      unpublished: 0,
      skipped: true,
      reason: `update error: ${upErr.message}`,
    };
  }

  return {
    unpublished: unpublished ?? 0,
    skipped: false,
    reason: `${unpublished ?? 0} venues dépubliées (${rowsUpserted}/${prevCount} vus)`,
  };
}
