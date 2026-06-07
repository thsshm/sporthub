"use client";

/**
 * Bottom sheet mobile pour la liste des venues (#256).
 * Donne accès à la liste sur mobile (mode map) via un panneau bas à 3 hauteurs :
 *   - peek : ~64 px — handle + count spots   (carte visible à ~92%)
 *   - mid  : 45 vh  — ~10 venues visibles     (carte visible à ~55%)
 *   - full : 88 vh  — liste quasi plein écran  (carte en arrière-plan)
 *
 * État initial = "peek" : on sait qu'il y a des spots SANS occulter la carte.
 * Tap sur le header → cycle peek → mid → full → peek. État syncé dans l'URL
 * (?sheet=peek|mid|full) côté parent pour les liens partagés.
 *
 * Implémentation CSS pure (hauteur pilotée par `snap`), volontairement SANS la
 * lib `vaul` : en contrôlé, ses snap points ne respectaient pas la hauteur
 * "peek" sur mobile et le drawer s'ouvrait plein écran en masquant la carte
 * (signalé en prod). Une hauteur déterministe par classe Tailwind élimine ce
 * comportement. On perd le drag libre, mais le tap-pour-déplier reste fluide.
 *
 * Visible uniquement sur mobile (< md). Sur desktop, la sidebar droite prend le relais.
 */
import { ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { formatCount } from "@/lib/utils";
import type { VenuePin } from "@/lib/supabase/types";

export type SheetSnap = "peek" | "mid" | "full";

/** Hauteur du panneau par snap. peek = header seul → la carte reste visible. */
const SNAP_HEIGHT: Record<SheetSnap, string> = {
  peek: "h-16", // 64px — handle + compteur
  mid: "h-[45vh]",
  full: "h-[88vh]",
};

/** Cycle au tap sur le header. */
const NEXT_SNAP: Record<SheetSnap, SheetSnap> = {
  peek: "mid",
  mid: "full",
  full: "peek",
};

type Props = {
  venues: VenuePin[];
  center: { lat: number; lon: number };
  visibleCount: number;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  onSelect?: (venue: VenuePin) => void;
};

export function MapBottomSheet({
  venues,
  center,
  visibleCount,
  snap,
  onSnapChange,
  onSelect,
}: Props) {
  const tMap = useTranslations("map");

  return (
    <div
      role="dialog"
      aria-label={tMap("venueList")}
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-t bg-background shadow-2xl transition-[height] duration-300 ease-out md:hidden ${SNAP_HEIGHT[snap]}`}
    >
      {/* Drag handle + header — tap → snap suivant (peek → mid → full → peek) */}
      <button
        type="button"
        aria-label={tMap("expandSheet")}
        className="flex w-full shrink-0 flex-col items-center px-4 pb-2 pt-2"
        onClick={() => onSnapChange(NEXT_SNAP[snap])}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex w-full items-center justify-between text-sm">
          <span className="font-semibold">
            {tMap("spotsInView", { count: formatCount(visibleCount) })}
          </span>
          <ChevronUp
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              snap === "full" ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* Corps : liste — masqué en peek pour garder la carte visible. */}
      <div className={`min-h-0 flex-1 overflow-auto ${snap === "peek" ? "hidden" : ""}`}>
        <VenueListPanel
          venues={venues}
          center={center}
          onSelect={(v) => {
            onSelect?.(v);
            if (snap === "peek") onSnapChange("mid");
          }}
          className="border-0 shadow-none"
        />
      </div>
    </div>
  );
}
