"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { approveClaim, rejectClaim, type ResolveClaimState } from "./actions";

type Decision = "approve" | "reject";

type Props = {
  claimId: string;
  /**
   * Si false, on désactive les boutons (claim déjà traitée).
   */
  canResolve: boolean;
};

/**
 * Boutons Approve/Reject avec confirmation modale + textarea note admin.
 *
 * On utilise un <dialog> natif (a11y correcte hors box, support focus trap
 * navigateur). Pas de dépendance shadcn AlertDialog ajoutée pour cette PR.
 */
export function ClaimActions({ claimId, canResolve }: Props) {
  const t = useTranslations("admin.claimRequests");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (d: Decision) => {
    setDecision(d);
    setNote("");
    setError(null);
  };
  const close = () => {
    if (pending) return;
    setDecision(null);
    setError(null);
  };

  const submit = () => {
    if (!decision) return;
    startTransition(async () => {
      const action = decision === "approve" ? approveClaim : rejectClaim;
      let result: ResolveClaimState;
      try {
        result = await action({ claimId, adminNote: note });
      } catch {
        setError(t("errorGeneric"));
        return;
      }
      if (!result.ok) {
        // Mapping minimal — code d'erreur → traduction
        const map: Record<string, string> = {
          claim_not_found: t("errorNotFound"),
          claim_already_resolved: t("errorAlreadyResolved"),
          note_too_long: t("errorNoteTooLong"),
          invalid_claim_id: t("errorGeneric"),
          db_update_claim_failed: t("errorGeneric"),
          db_update_venue_failed: t("errorGeneric"),
        };
        setError(map[result.error] ?? t("errorGeneric"));
        return;
      }
      setDecision(null);
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => open("approve")}
          disabled={!canResolve || pending}
          className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-900 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("actionApprove")}
        </button>
        <button
          type="button"
          onClick={() => open("reject")}
          disabled={!canResolve || pending}
          className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("actionReject")}
        </button>
      </div>

      {decision && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`claim-${claimId}-dialog-title`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id={`claim-${claimId}-dialog-title`}
              className="text-base font-semibold"
            >
              {decision === "approve"
                ? t("confirmApproveTitle")
                : t("confirmRejectTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {decision === "approve"
                ? t("confirmApproveBody")
                : t("confirmRejectBody")}
            </p>

            <label className="mt-4 block text-xs font-medium">
              {t("noteLabel")}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder={t("notePlaceholder")}
                className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </label>

            {error && (
              <p className="mt-2 text-xs text-red-700" role="alert">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className={
                  decision === "approve"
                    ? "rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                    : "rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                }
              >
                {pending
                  ? t("submitting")
                  : decision === "approve"
                    ? t("confirmApprove")
                    : t("confirmReject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
