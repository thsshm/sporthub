"use client";

import { trackEvent } from "@/lib/monitoring";

/**
 * CTA « Demander l'accès anticipé » de la page /developers (#561).
 *
 * Reste un simple lien mailto (pré-rempli côté serveur) — donc fonctionnel sans
 * JS — mais émet un event PostHog `developers_early_access_click` au clic pour
 * mesurer la demande d'API. Client Component minimal (juste le onClick).
 */
export function DevelopersAccessCta({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      onClick={() => trackEvent("developers_early_access_click")}
      className="mt-4 inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {label}
    </a>
  );
}
