"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FAMILIES_BY_SLUG } from "@/lib/families";

type Props = {
  /** Slugs des familles actives à afficher dans la légende. */
  activeSlugs: string[];
  className?: string;
};

/**
 * Légende des couleurs par famille (mode explore multi-disciplines, #132).
 *
 * Repliable (#441) : sur mobile la légende pleine largeur chevauchait les
 * boutons géoloc/zoom en bas-droite. Désormais elle est repliée par défaut sur
 * mobile (puce compacte : aperçu de pastilles + libellé) et se déplie au clic.
 * Sur desktop (≥ md) elle reste dépliée par défaut (comportement inchangé).
 * L'anti-chevauchement est aussi garanti par le positionnement parent
 * (ancrée à gauche + largeur plafonnée sur mobile, cf. MapWithSearch).
 */
export function MapLegend({ activeSlugs, className }: Props) {
  const tFamilies = useTranslations("families");
  const tMap = useTranslations("map");

  // SSR-safe : repliée par défaut, dépliée au mount si écran large (desktop).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      setExpanded(true);
    }
  }, []);

  const slugs = activeSlugs.filter((s) => FAMILIES_BY_SLUG[s]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-label={tMap("legend")}
        className={`pointer-events-auto flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-md backdrop-blur ${className ?? ""}`}
      >
        <span className="flex items-center -space-x-1" aria-hidden="true">
          {slugs.slice(0, 5).map((slug) => (
            <span
              key={slug}
              className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-background"
              style={{ backgroundColor: FAMILIES_BY_SLUG[slug]!.color }}
            />
          ))}
        </span>
        <span className="whitespace-nowrap font-medium">{tMap("legend")}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={tMap("legend")}
      // Mobile : largeur plafonnée pour laisser la colonne de boutons
      // (géoloc/zoom) à droite ; scroll horizontal au-delà. Desktop : 42rem.
      className={`pointer-events-auto flex max-w-[calc(100vw-5.5rem)] items-center gap-2.5 overflow-x-auto rounded-full border bg-background/90 px-2.5 py-1.5 text-xs shadow-md backdrop-blur md:max-w-[42rem] ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(false)}
        aria-label={tMap("legend")}
        className="flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {slugs.map((slug) => {
        const f = FAMILIES_BY_SLUG[slug];
        if (!f) return null;
        return (
          <span key={slug} className="flex shrink-0 items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: f.color }}
              aria-hidden="true"
            />
            <span aria-hidden="true">{f.emoji}</span>
            <span className="whitespace-nowrap">{tFamilies(slug)}</span>
          </span>
        );
      })}
    </div>
  );
}
