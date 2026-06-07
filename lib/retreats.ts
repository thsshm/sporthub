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
  sport_type: string | null;
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
  "id, public_id, title, organizer_name, venue_external_name, city, country, sport_type, " +
  "start_date, end_date, duration_nights, includes_lodging, includes_meals, " +
  "price_from_eur, price_currency, booking_url";

/** Saisons (hémisphère nord) pour le filtre du panneau stages (#266 palier 2). */
export type Season = "spring" | "summer" | "autumn" | "winter";
export const RETREAT_SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** Filtres du panneau « Stages à venir ». */
export type RetreatFilters = {
  /** Hébergement inclus uniquement. */
  lodging?: boolean;
  /** Saison (dérivée de start_date — pas exprimable simplement en SQL sur DATE). */
  season?: Season | null;
  /** Type de sport/retraite (`retreat_event.sport_type`). */
  sport?: string | null;
};

/**
 * Saison (hémisphère nord) d'une date 'YYYY-MM-DD'. `null` si date absente
 * ou invalide. Pure / testable. déc-fév = hiver, mar-mai = printemps,
 * juin-août = été, sep-nov = automne.
 */
export function retreatSeason(startISO: string | null): Season | null {
  if (!startISO || startISO.length < 7) return null;
  const m = Number(startISO.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5) return "spring";
  if (m <= 8) return "summer";
  return "autumn";
}

/** Filtre une liste de stages par saison (pure). `null` → liste inchangée. */
export function filterBySeason(retreats: RetreatEvent[], season: Season | null): RetreatEvent[] {
  if (!season) return retreats;
  return retreats.filter((r) => retreatSeason(r.start_date) === season);
}

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
export async function getUpcomingRetreats(
  filters: RetreatFilters = {},
  limit = 12,
  now: Date = new Date(),
): Promise<RetreatEvent[]> {
  const sb = getSupabaseServerClient() as unknown as SupabaseClient;
  let q = sb
    .from("retreat_event")
    .select(SELECT_COLS)
    .eq("status", "published")
    .gte("start_date", todayISO(now));
  // Filtres exprimables en SQL (egalité). La saison, non (mois d'une colonne
  // DATE) → filtrée côté Node après fetch ; on élargit alors le fetch pour ne
  // pas tronquer avant de filtrer, puis on recoupe à `limit`.
  if (filters.sport) q = q.eq("sport_type", filters.sport);
  if (filters.lodging) q = q.eq("includes_lodging", true);
  q = q.order("start_date", { ascending: true }).limit(filters.season ? 200 : limit);

  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as unknown as RetreatEvent[];
  if (filters.season) rows = filterBySeason(rows, filters.season).slice(0, limit);
  return rows;
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
