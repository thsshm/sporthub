"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

type OAuthStatus =
  | { kind: "idle" }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  const t = useTranslations("admin.login");
  return (
    <Suspense
      fallback={
        <main className="container mx-auto max-w-md px-6 py-16">
          {t("loading")}
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M21.35 11.1H12v3.83h5.36c-.23 1.41-1.66 4.13-5.36 4.13-3.22 0-5.85-2.67-5.85-5.96 0-3.29 2.63-5.96 5.85-5.96 1.83 0 3.06.78 3.76 1.45l2.57-2.48C16.62 4.55 14.55 3.6 12 3.6 6.97 3.6 2.9 7.67 2.9 12.7c0 5.03 4.07 9.1 9.1 9.1 5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.06-.18-1.52z"
        fill="currentColor"
      />
    </svg>
  );
}

function LoginForm() {
  const t = useTranslations("admin.login");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ kind: "idle" });
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "sending" });

    const sb = getSupabaseBrowserClient();
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) {
      setStatus({ kind: "error", message: error.message });
    } else {
      setStatus({ kind: "sent" });
    }
  }

  async function handleGoogleSignIn() {
    setOauthStatus({ kind: "redirecting" });

    const sb = getSupabaseBrowserClient();
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) {
      setOauthStatus({ kind: "error", message: error.message });
    }
    // If no error, the browser is being redirected to Google — no further state.
  }

  const formDisabled =
    status.kind === "sending" ||
    status.kind === "sent" ||
    oauthStatus.kind === "redirecting";

  return (
    <main className="container mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("intro")}</p>

      <div className="mt-8 space-y-4">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={formDisabled}
        >
          {oauthStatus.kind === "redirecting" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleIcon className="h-4 w-4" />
          )}
          {t("signInWithGoogle")}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("or")}
            </span>
          </div>
        </div>
      </div>

      {oauthStatus.kind === "error" && (
        <div
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("errorTitle")}</p>
              <p className="mt-1">{oauthStatus.message}</p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{t("emailLabel")}</span>
          <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 focus-within:border-primary">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="w-full bg-transparent text-sm outline-none"
              disabled={formDisabled}
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={formDisabled || email.length < 5}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {status.kind === "sending" && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {status.kind === "sent" ? t("submitSent") : t("submit")}
        </button>
      </form>

      {status.kind === "sent" && (
        <div
          className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900"
          role="status"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("sentTitle")}</p>
              <p className="mt-1">
                {t.rich("sentDescription", {
                  email,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <div
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("errorTitle")}</p>
              <p className="mt-1">{status.message}</p>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        {t("noPasswordHint")}{" "}
        <Link href="/" className="underline hover:text-foreground">
          {t("backHome")}
        </Link>
      </p>
    </main>
  );
}
