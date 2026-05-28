"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="container mx-auto max-w-md px-6 py-16">Chargement…</main>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
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

  return (
    <main className="container mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Connexion</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Reçois un lien magique par email pour accéder à tes favoris et soumettre
        des claims.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 focus-within:border-primary">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              className="w-full bg-transparent text-sm outline-none"
              disabled={status.kind === "sending" || status.kind === "sent"}
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={
            status.kind === "sending" ||
            status.kind === "sent" ||
            email.length < 5
          }
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {status.kind === "sending" && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {status.kind === "sent" ? "Lien envoyé" : "Envoyer le lien magique"}
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
              <p className="font-semibold">Email envoyé !</p>
              <p className="mt-1">
                Clique sur le lien dans le mail reçu à <strong>{email}</strong>{" "}
                pour te connecter. Vérifie aussi tes spams.
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
              <p className="font-semibold">Erreur</p>
              <p className="mt-1">{status.message}</p>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Pas de mot de passe à retenir.{" "}
        <Link href="/" className="underline hover:text-foreground">
          Retour à l&apos;accueil
        </Link>
      </p>
    </main>
  );
}
