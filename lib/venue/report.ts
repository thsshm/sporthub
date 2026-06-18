/**
 * Signalement d'erreur sur une venue (#613) — types + validation pure.
 *
 * Partagé entre la route POST /api/report (validation serveur) et le composant
 * client de signalement (mêmes types). Aucune I/O → testable.
 */

/** Types de problème proposés (alignés sur le CHECK de la table venue_report). */
export const REPORT_ISSUE_TYPES = [
  "closed", // lieu fermé / n'existe plus
  "wrong_sport", // mauvais sport / mal classé
  "wrong_info", // adresse, nom, horaires erronés
  "duplicate", // doublon d'une autre fiche
  "other", // autre
] as const;

export type ReportIssueType = (typeof REPORT_ISSUE_TYPES)[number];

/** Longueur max de la note libre (anti-spam léger + borne DB raisonnable). */
export const MAX_REPORT_NOTE = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportInput = {
  venue_id: string;
  issue_type: ReportIssueType;
  note: string | null;
};

export type ReportValidation =
  | { ok: true; value: ReportInput }
  | { ok: false; error: string };

/** Valide le corps d'un signalement. Pur — réutilisé côté route et tests. */
export function validateReportInput(body: unknown): ReportValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;

  const venue_id = typeof b.venue_id === "string" ? b.venue_id.trim() : "";
  if (!UUID_RE.test(venue_id)) return { ok: false, error: "venue_id invalide" };

  const issue_type = b.issue_type;
  if (
    typeof issue_type !== "string" ||
    !(REPORT_ISSUE_TYPES as readonly string[]).includes(issue_type)
  ) {
    return { ok: false, error: "issue_type invalide" };
  }

  let note: string | null = null;
  if (b.note != null) {
    if (typeof b.note !== "string") return { ok: false, error: "note invalide" };
    const trimmed = b.note.trim();
    if (trimmed.length > MAX_REPORT_NOTE) return { ok: false, error: "note trop longue" };
    note = trimmed || null;
  }

  return { ok: true, value: { venue_id, issue_type: issue_type as ReportIssueType, note } };
}
