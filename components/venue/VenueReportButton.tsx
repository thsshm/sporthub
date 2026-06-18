"use client";

/**
 * Bouton + modale de signalement d'erreur sur une venue (#613).
 *
 * Remplace le mailto « Signaler une erreur » par un flux structuré : type de
 * problème (fermé / mauvais sport / info erronée / doublon / autre) + note
 * libre optionnelle → POST /api/report. SANS compte. Client Component (état +
 * fetch). i18n via le namespace "venue.report".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { REPORT_ISSUE_TYPES, type ReportIssueType, MAX_REPORT_NOTE } from "@/lib/venue/report";

type Status = "idle" | "sending" | "done" | "error";

export function VenueReportButton({
  venueId,
  className,
}: {
  venueId: string;
  className?: string;
}) {
  const t = useTranslations("venue.report");
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState<ReportIssueType>(REPORT_ISSUE_TYPES[0]);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Reset différé pour ne pas voir le formulaire « flasher » à la fermeture.
    setTimeout(() => setStatus("idle"), 200);
  }, []);

  // Escape ferme ; focus la modale à l'ouverture (a11y).
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = async () => {
    setStatus("sending");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue_id: venueId, issue_type: issueType, note: note.trim() || null }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-xs text-muted-foreground hover:text-foreground hover:underline"
        }
      >
        {t("trigger")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-xl outline-none"
          >
            {status === "done" ? (
              <div className="space-y-3 text-center">
                <p className="text-sm font-medium text-foreground">{t("thanksTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("thanksBody")}</p>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  {t("closeCta")}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
                <fieldset className="space-y-1.5">
                  <legend className="sr-only">{t("typeLegend")}</legend>
                  {REPORT_ISSUE_TYPES.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                    >
                      <input
                        type="radio"
                        name="issue_type"
                        value={key}
                        checked={issueType === key}
                        onChange={() => setIssueType(key)}
                        className="h-3.5 w-3.5 cursor-pointer"
                      />
                      <span>{t(`type.${key}`)}</span>
                    </label>
                  ))}
                </fieldset>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_REPORT_NOTE))}
                  placeholder={t("notePlaceholder")}
                  rows={3}
                  className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {status === "error" && (
                  <p className="text-xs text-red-600 dark:text-red-400">{t("error")}</p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={status === "sending"}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {status === "sending" ? t("sending") : t("submit")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
