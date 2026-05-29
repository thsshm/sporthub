"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Props = {
  venueId: string;
  venueSlug: string;
  userEmail: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function ClaimForm({ venueId, venueSlug, userEmail }: Props) {
  const t = useTranslations("claim");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "sending" });
    const fd = new FormData(e.currentTarget);

    const res = await fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venueId,
        email: fd.get("email"),
        name: fd.get("name"),
        role: fd.get("role"),
        proof_text: fd.get("proof_text"),
      }),
    });

    if (res.ok) {
      setStatus({ kind: "sent" });
      setTimeout(() => router.push(`/venue/${venueSlug}?claim=submitted`), 1500);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ kind: "error", message: body.error || t("errorUnknown") });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t("successTitle")}</p>
            <p className="mt-1">{t("successHint")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium">{t("emailLabel")}</span>
        <input
          type="email"
          name="email"
          required
          defaultValue={userEmail}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("nameLabel")}</span>
        <input
          type="text"
          name="name"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("roleLabel")}</span>
        <select
          name="role"
          defaultValue=""
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">{t("roleChoose")}</option>
          <option value="owner">{t("roleOwner")}</option>
          <option value="manager">{t("roleManager")}</option>
          <option value="marketing">{t("roleMarketing")}</option>
          <option value="other">{t("roleOther")}</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("proofLabel")}</span>
        <textarea
          name="proof_text"
          rows={4}
          placeholder={t("proofPlaceholder")}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {status.kind === "sending" && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {t("submitButton")}
      </button>

      {status.kind === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{status.message}</span>
          </div>
        </div>
      )}
    </form>
  );
}
