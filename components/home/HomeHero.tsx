"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useFeatureFlagVariantKey } from "posthog-js/react";
import posthog from "posthog-js";
import { formatCount } from "@/lib/utils";

/**
 * Hero de la home — A/B `home_layout` (#253).
 *
 * Problème (mobile) : un arrivant SERP/social doit scroller 3-4 écrans de
 * brochure avant d'atteindre une carte ou un CTA. Le variant `map-first` met la
 * carte au premier plan (hero compact + « Carte près de moi » géolocalisé).
 *
 * - **Contrôle** (`brochure`, ou flag absent/non résolu) → hero brochure, mais
 *   désormais avec un CTA PRIMAIRE « près de moi » géolocalisé (#605) : on met
 *   en avant le chemin le plus rapide (« trouve un spot près de moi »), et
 *   « Explorer la carte » / « Liste par sport » deviennent secondaires.
 * - **`map-first`** → hero compact + même CTA géoloc.
 *
 * Le flag se pilote/rollout depuis PostHog (`home_layout` = `control` |
 * `map-first`). Métrique clé exposée : event `home_map_cta_click`.
 */
export function HomeHero({ totalSpots }: { totalSpots: number }) {
  const t = useTranslations("home");
  const router = useRouter();
  const variant = useFeatureFlagVariantKey("home_layout");
  const [locating, setLocating] = useState(false);

  /** « Près de moi » : géoloc navigateur → carte centrée ; repli /map (#605). */
  const goNearMe = () => {
    posthog.capture("home_map_cta_click", {
      variant: variant === "map-first" ? "map-first" : "control",
    });
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      router.push("/map");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        router.push(
          `/map?lat=${pos.coords.latitude.toFixed(4)}&lon=${pos.coords.longitude.toFixed(4)}&zoom=12`,
        ),
      () => {
        router.push("/map");
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  if (variant === "map-first") {
    return (
      <section className="border-b bg-gradient-to-b from-muted/40 to-background">
        <div className="container mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">{t("heroTitle")}</h1>
          <p className="mt-2 text-base text-muted-foreground">{t("mapFirstTagline")}</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={goNearMe}
              disabled={locating}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <MapPin className="h-5 w-5" aria-hidden="true" />
              {locating ? t("ctaLocating") : t("ctaNearMe")}
            </button>
            {/* Ancre vers la grille familles (restée visible plus bas). Lien de
                page identique (#hash) → <a> natif, pas le Link i18n. */}
            <a
              href="#families"
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("ctaDiscoverSports")}
            </a>
          </div>
        </div>
      </section>
    );
  }

  // Contrôle / défaut : brochure, mais CTA primaire « près de moi » (#605).
  return (
    <section className="border-b bg-gradient-to-b from-muted/40 to-background">
      <div className="container mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{t("heroTitle")}</h1>
        <p className="mt-3 text-lg text-muted-foreground md:text-xl">{t("heroSubtitle")}</p>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground">
          {t("heroDescription", { count: formatCount(totalSpots) })}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {/* CTA primaire = le chemin le plus rapide, « près de moi » (#605). */}
          <button
            type="button"
            onClick={goNearMe}
            disabled={locating}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {locating ? t("ctaLocating") : t("ctaNearMe")}
          </button>
          <Link
            href="/map"
            className="inline-flex items-center gap-1.5 rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent"
          >
            {t("ctaMap")}
          </Link>
          <Link
            href="/sports/tennis"
            className="inline-flex items-center rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent"
          >
            {t("ctaList")}
          </Link>
        </div>
      </div>
    </section>
  );
}
