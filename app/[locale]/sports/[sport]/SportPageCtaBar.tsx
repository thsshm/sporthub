"use client";

import { useState } from "react";
import { MapPin, Map } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";

/**
 * @param familySlug — famille du sport courant. Passée à la carte (`?family=`)
 *   pour PRÉSERVER le contexte quand on clique « près de moi » (#605). La carte
 *   filtre au niveau famille (pas par sport exact, cf. /map ?family=).
 */
export function SportPageCtaBar({ familySlug }: { familySlug?: string }) {
  const t = useTranslations("sport");
  const router = useRouter();
  const [locating, setLocating] = useState(false);

  const famQS = familySlug ? `&family=${familySlug}` : "";
  const mapHref = familySlug ? `/map?family=${familySlug}` : "/map";

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      router.push(mapHref as Parameters<typeof router.push>[0]);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude.toFixed(4);
        const lon = coords.longitude.toFixed(4);
        // Carte centrée sur l'utilisateur, en CONSERVANT le filtre famille (#605).
        router.push(
          `/map?lat=${lat}&lon=${lon}&zoom=12${famQS}` as Parameters<typeof router.push>[0],
        );
      },
      () => {
        // Permission refusée/indispo — repli sur la carte (filtre famille gardé).
        router.push(mapHref as Parameters<typeof router.push>[0]);
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={handleNearMe}
        disabled={locating}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
        aria-label={t("ctaNearMe")}
      >
        <MapPin className="h-4 w-4" aria-hidden="true" />
        {locating ? t("ctaLocating") : t("ctaNearMe")}
      </button>
      <Link
        href={mapHref}
        className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <Map className="h-4 w-4" aria-hidden="true" />
        {t("ctaOpenMap")}
      </Link>
    </div>
  );
}
