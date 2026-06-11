"use client";

import { useState } from "react";
import { MapPin, Map } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";

export function SportPageCtaBar() {
  const t = useTranslations("sport");
  const router = useRouter();
  const [locating, setLocating] = useState(false);

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      router.push("/map" as Parameters<typeof router.push>[0]);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude.toFixed(4);
        const lon = coords.longitude.toFixed(4);
        // Navigate to the interactive map centred on user position.
        router.push(
          `/map?lat=${lat}&lon=${lon}&zoom=12` as Parameters<typeof router.push>[0],
        );
      },
      () => {
        // Permission denied or unavailable — fall back to plain map.
        router.push("/map" as Parameters<typeof router.push>[0]);
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
        href="/map"
        className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <Map className="h-4 w-4" aria-hidden="true" />
        {t("ctaOpenMap")}
      </Link>
    </div>
  );
}
