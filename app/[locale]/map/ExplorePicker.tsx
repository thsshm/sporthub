"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, X } from "lucide-react";
import { SearchBar, type SearchResult } from "@/components/SearchBar";
import { FAMILIES } from "@/lib/families";

export type PickerSelection = {
  /** Slugs des familles cochées (au moins 1 garanti par le bouton disabled). */
  families: string[];
  /** Ville optionnelle choisie via le SearchBar Nominatim, ou null. */
  city: SearchResult | null;
};

type Props = {
  /** Validation du picker — déclenche la navigation + persistance "vu". */
  onSubmit: (sel: PickerSelection) => void;
  /** Fermeture sans valider (croix). Si absent, pas de croix (1er visit forcé). */
  onClose?: () => void;
  /** Pré-sélection (cas "Changer ma sélection" qui rouvre avec l'état courant). */
  initialFamilies?: string[];
};

/**
 * Overlay full-screen affiché au premier visit de /map sans filtre, ou rouvert
 * via "Changer ma sélection". Point d'entrée explore : choix multi-familles +
 * ville optionnelle, puis navigation vers /map?family=…&q=…. Cf. issue #132.
 */
export function ExplorePicker({ onSubmit, onClose, initialFamilies }: Props) {
  const tMap = useTranslations("map");
  const tFamilies = useTranslations("families");

  const [selected, setSelected] = useState<Set<string>>(() =>
    initialFamilies && initialFamilies.length > 0
      ? new Set(initialFamilies)
      : new Set(FAMILIES.map((f) => f.slug))
  );
  const [city, setCity] = useState<SearchResult | null>(null);

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(FAMILIES.map((f) => f.slug)));
  const selectNone = () => setSelected(new Set());

  const canSubmit = selected.size > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tMap("picker.title")}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-full w-full max-w-lg flex-col gap-4 overflow-auto rounded-xl bg-background p-6 shadow-2xl">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={tMap("closeFilters")}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <div className="space-y-1 pr-6">
          <h2 className="text-xl font-bold">{tMap("picker.title")}</h2>
          <p className="text-sm text-muted-foreground">{tMap("picker.subtitle")}</p>
        </div>

        {/* Tout sélectionner / désélectionner — cohérent avec #122 */}
        <div className="flex gap-3 text-xs font-medium">
          <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">
            {tMap("picker.selectAll")}
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={selectNone} className="text-blue-600 hover:underline">
            {tMap("picker.selectNone")}
          </button>
        </div>

        {/* Chips 13 familles multi-select */}
        <div className="flex flex-wrap gap-2">
          {FAMILIES.map((f) => {
            const active = selected.has(f.slug);
            const name = tFamilies(f.slug);
            return (
              <button
                key={f.slug}
                type="button"
                aria-pressed={active}
                aria-label={name}
                onClick={() => toggle(f.slug)}
                className="rounded-full border px-3 py-1.5 text-sm font-medium transition hover:opacity-90"
                style={
                  active
                    ? { backgroundColor: f.color, color: "white", borderColor: f.color }
                    : { borderColor: `${f.color}66`, color: f.color }
                }
              >
                <span aria-hidden="true" className="mr-1">
                  {f.emoji}
                </span>
                {name}
              </button>
            );
          })}
        </div>

        {/* Ville optionnelle (réutilise SearchBar Nominatim — #13) */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{tMap("picker.cityLabel")}</label>
          {city ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{city.display_name}</span>
              </span>
              <button
                type="button"
                onClick={() => setCity(null)}
                aria-label={tMap("closeFilters")}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <SearchBar onSelect={setCity} placeholder={tMap("picker.cityPlaceholder")} />
          )}
        </div>

        {/* Explorer → (disabled si 0 famille), gradient orange/jaune */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ families: Array.from(selected), city })}
          className="mt-1 flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-400 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {tMap("picker.submit")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
