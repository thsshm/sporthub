"use client";

/**
 * Toast d'invitation à installer la PWA (#249).
 *
 * Écoute l'event `beforeinstallprompt` (Chrome/Edge Android + desktop), le
 * conserve, et propose un toast discret APRÈS un seuil d'engagement (≥ 2
 * visites distinctes) pour ne pas harceler un nouveau visiteur. Au clic, on
 * déclenche le prompt natif d'installation.
 *
 * iOS Safari ne supporte pas `beforeinstallprompt` → pas de toast là-bas
 * (l'utilisateur passe par Partager → « Sur l'écran d'accueil ») ; on ne le
 * sollicite donc pas pour éviter une UI qui ne mène nulle part.
 *
 * No-op total une fois installé (l'event ne fire pas en mode standalone) ou si
 * l'utilisateur a déjà refusé (flag localStorage).
 */
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";

const DISMISSED_KEY = "sporthub_pwa_dismissed";
const VISITS_KEY = "sporthub_visits";
const MIN_VISITS = 2;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPwaButton() {
  const t = useTranslations("pwa");
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Compteur de visites (incrémenté une fois par session via sessionStorage).
    try {
      if (!sessionStorage.getItem("sporthub_counted")) {
        sessionStorage.setItem("sporthub_counted", "1");
        const visits = Number(localStorage.getItem(VISITS_KEY) ?? "0") + 1;
        localStorage.setItem(VISITS_KEY, String(visits));
      }
    } catch {
      /* storage indisponible → on continue sans compter */
    }

    // Déjà refusé / déjà installé → on n'affiche rien.
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      /* noop */
    }
    if (window.matchMedia?.("(display-mode: standalone)").matches) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // empêche le mini-infobar Chrome par défaut
      let visits = 0;
      try {
        visits = Number(localStorage.getItem(VISITS_KEY) ?? "0");
      } catch {
        /* noop */
      }
      if (visits < MIN_VISITS) return; // pas assez engagé → on garde pour plus tard
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* noop */
    }
  };

  const install = async () => {
    if (!promptEvent) return;
    setVisible(false);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      /* l'utilisateur a fermé le prompt natif → rien à faire */
    }
    // Quoi qu'il arrive, on ne re-sollicite plus automatiquement.
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* noop */
    }
    setPromptEvent(null);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t("installTitle")}
      className="bottom-safe-4 fixed left-1/2 z-50 w-[min(380px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border bg-background p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Download className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("installTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("installText")}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={install}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("installCta")}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              {t("installLater")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("installLater")}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
