"use client";

/**
 * Bandeau « Mode hors-ligne » (#249 part 2).
 *
 * S'affiche quand le navigateur passe offline (navigator.onLine + events
 * online/offline). Couplé au service worker : les pages déjà visitées + la
 * dernière vue carte restent accessibles depuis le cache, et ce bandeau
 * informe l'utilisateur qu'il consulte une version potentiellement périmée.
 */
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

export function OfflineBanner() {
  const t = useTranslations("pwa");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const update = () => setOffline(!navigator.onLine);
    update(); // état initial
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <span className="inline-flex items-center gap-1.5">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        {t("offline")}
      </span>
    </div>
  );
}
