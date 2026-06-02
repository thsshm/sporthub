import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Stage / retraite daté — sous-ensemble des colonnes de `retreat_event`
 * (migration 0030) rendues par le panneau « Stages à venir » (#266).
 */
export type RetreatEvent = {
  id: string;
  public_id: string | null;
  title: string;
  organizer_name: string | null;
  venue_external_name: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null; // 'YYYY-MM-DD'
  end_date: string | null;
  duration_nights: number | null;
  includes_lodging: boolean | null;
  includes_meals: boolean | null;
  price_from_eur: number | null;
  price_currency: string;
  booking_url: string | null;
};

const SELECT_COLS =
  "id, public_id, title, organizer_name, venue_external_name, city, country, " +
  "start_date, end_date, duration_nights, includes_lodging, includes_meals, " +
  "price_from_eur, price_currency, booking_url";

/** Date du jour au format 'YYYY-MM-DD' (comparaison contre la colonne DATE). */
function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Stages publiés à venir (start_date ≥ aujourd'hui), triés par date de début.
 * S'appuie sur l'index partiel `idx_retreat_event_upcoming` (0030).
 *
 * Typage : `retreat_event` n'est pas dans les types Supabase générés tant que
 * 0030 n'a pas été appliqué + régénéré → on passe par un client non-typé
 * (cast localisé), même pattern que `clubs_in_bbox` / 0015
 * (cf. app/api/venues/clubs/route.ts). Le résultat est re-typé explicitement.
 */
export async function getUpcomingRetreats(limit = 12, now: Date = new Date()): Promise<RetreatEvent[]> {
  const sb = getSupabaseServerClient() as unknown as SupabaseClient;
  const { data, error } = await sb
    .from("retreat_event")
    .select(SELECT_COLS)
    .eq("status", "published")
    .gte("start_date", todayISO(now))
    .order("start_date", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as RetreatEvent[];
}

/**
 * Formate une plage de dates de stage selon la locale (via `Intl`, donc
 * compatible toute locale du projet : fr / en / zh).
 *   - une seule date        → « 25 juin 2026 »
 *   - même mois/année       → « 25 – 30 juin 2026 »
 *   - mois différents       → « 25 juin – 2 juil. 2026 »
 * Retourne `null` si aucune date n'est fournie.
 *
 * Note : les dates sont des `DATE` SQL (sans fuseau) → on ancre en UTC pour
 * éviter tout décalage de jour selon le fuseau du serveur de rendu.
 */
export function formatRetreatDateRange(
  start: string | null,
  end: string | null,
  locale: string,
): string | null {
  const s = start ? new Date(`${start}T00:00:00Z`) : null;
  const e = end ? new Date(`${end}T00:00:00Z`) : null;
  if (!s && !e) return null;

  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(d);
  const full: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

  if (s && !e) return fmt(s, full);
  if (e && !s) return fmt(e, full);
  // s && e
  const sameMonth =
    s!.getUTCFullYear() === e!.getUTCFullYear() && s!.getUTCMonth() === e!.getUTCMonth();
  const left = sameMonth ? fmt(s!, { day: "numeric" }) : fmt(s!, { day: "numeric", month: "short" });
  return `${left} – ${fmt(e!, full)}`;
}

/**
 * Prix « à partir de » formaté en devise (montant entier, sans décimales), ou
 * `null` si pas de prix. Devise vide → EUR par défaut.
 */
export function formatPriceFrom(
  amount: number | null,
  currency: string,
  locale: string,
): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}
