"use client";

/**
 * Bottom sheet mobile à 3 snap points pour la liste des venues (#256).
 * Remplace l'absence de liste sur mobile (mode map) par un drawer Vaul
 * persistant en bas de l'écran avec 3 positions :
 *   - peek  : 80 px  — drag handle + count spots  (carte visible à 90%)
 *   - mid   : 45 %   — ~10 venues visibles         (carte visible à 55%)
 *   - full  : 92 %   — liste quasi plein écran      (carte masquée)
 *
 * L'état initial est "peek" : on sait qu'il y a des spots sans occulter la carte.
 * Tap sur le header → mid. Drag libre entre les 3 snap points.
 * L'état actif est syncé dans l'URL (?sheet=peek|mid|full) pour les liens partagés.
 *
 * Visible uniquement sur mobile (< md). Sur desktop, la sidebar droite prend le relais.
 */
import { Drawer } from "vaul";
import { ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { VenueListPanel } from "@/app/[locale]/map/VenueListPanel";
import { formatCount } from "@/lib/utils";
import type { VenuePin } from "@/lib/supabase/types";

const SNAP_POINTS = ["80px", "45%", "92%"] as const;
type SnapPoint = (typeof SNAP_POINTS)[number];
export type SheetSnap = "peek" | "mid" | "full";

const SNAP_TO_KEY: Record<SnapPoint, SheetSnap> = {
  "80px": "peek",
  "45%": "mid",
  "92%": "full",
};
const KEY_TO_SNAP: Record<SheetSnap, SnapPoint> = {
  peek: "80px",
  mid: "45%",
  full: "92%",
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
    <Drawer.Root
      open
      modal={false}
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={KEY_TO_SNAP[snap]}
      setActiveSnapPoint={(s) => {
        if (s && s in SNAP_TO_KEY) onSnapChange(SNAP_TO_KEY[s as SnapPoint]);
      }}
      // Ne pas fermer sur swipe bas — la carte doit rester accessible sans fermer
      // le sheet. Atteindre peek est la position minimale.
      dismissible={false}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="
            fixed bottom-0 left-0 right-0 z-30
            flex flex-col
            rounded-t-xl border-t bg-background shadow-2xl
            outline-none
            md:hidden
          "
          aria-label={tMap("venueList")}
        >
          {/* Drag handle + header — tap → snap mid */}
          <button
            type="button"
            aria-label={tMap("expandSheet")}
            className="flex w-full flex-col items-center px-4 pb-3 pt-2"
            onClick={() => onSnapChange(snap === "peek" ? "mid" : snap === "mid" ? "full" : "mid")}
          >
            {/* Handle Vaul standard */}
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
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

          {/* Corps : liste des venues — masqué en peek pour garder la carte visible */}
          <div
            className={`flex-1 overflow-auto ${snap === "peek" ? "invisible h-0" : ""}`}
          >
            <VenueListPanel
              venues={venues}
              center={center}
              onSelect={(v) => {
                onSelect?.(v);
                // Monter au snap mid quand on sélectionne un venue en mode mid/full
                if (snap === "peek") onSnapChange("mid");
              }}
              className="border-0 shadow-none"
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
