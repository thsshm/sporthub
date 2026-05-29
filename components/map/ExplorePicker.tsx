"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { FAMILIES } from "@/lib/families";

/**
 * Picker initial du mode "explore" sur /map (#132).
 *
 * Reprend le pattern V1 (sporthubmap.com/explore) :
 *   - Overlay full-screen au premier visit
 *   - Chips multi-select pour les 13 familles SportHub
 *   - Boutons "Tout sélectionner" / "Tout désélectionner"
 *   - Input ville optionnel (Nominatim — interne au composant, pas via le
 *     SearchBar global qui ne fait que setFlyTarget côté MapClient)
 *   - Bouton "Explorer →" qui passe une sélection au parent
 *
 * Le composant est volontairement self-contained : il ne touche pas au
 * localStorage ni à l'URL. C'est `MapWithSearch` qui gère ces effets de bord.
 */
type NominatimRow = {
  display_name: string;
  lat: string;
  lon: string;
};

export type CityResult = {
  name: string;
  lat: number;
  lon: number;
};

export type PickerSelection = {
  families: Set<string>;
  city: CityResult | null;
};

type Props = {
  /** Familles pré-sélectionnées (défaut = toutes les 13). */
  initialFamilies?: Set<string>;
  /** Appelé quand l'utilisateur clique "Explorer →". */
  onSubmit: (selection: PickerSelection) => void;
  /** Appelé quand l'utilisateur ferme le picker (ESC ou ✕). null si non
   * fermable (premier visit forcé). */
  onClose?: () => void;
};

export function ExplorePicker({
  initialFamilies,
  onSubmit,
  onClose,
}: Props) {
  const tFamilies = useTranslations("families");
  const tPicker = useTranslations("map.explore");

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialFamilies ?? FAMILIES.map((f) => f.slug)),
  );

  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<CityResult[]>([]);
  const [citySelected, setCitySelected] = useState<CityResult | null>(null);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  // Timer du debounce Nominatim — annulé à chaque nouveau keystroke pour
  // n'envoyer qu'une seule requête après 400ms de stabilité.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search Nominatim. On ne wrap pas le SearchBar global ici car
  // celui-ci appelle directement onSelect={setFlyTarget} et ne renvoie pas
  // l'objet structuré CityResult (nom + lat/lon) dont on a besoin pour
  // passer `q=` dans l'URL après validation.
  const handleCityChange = (value: string) => {
    setCityQuery(value);
    setCitySelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) {
      setCityResults([]);
      setCityLoading(false);
      setCityDropdownOpen(false);
      return;
    }
    setCityLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&accept-language=fr`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setCityResults([]);
          return;
        }
        const data = (await res.json()) as NominatimRow[];
        setCityResults(
          data.map((r) => ({
            name: r.display_name,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
          })),
        );
        setCityDropdownOpen(true);
      } catch {
        setCityResults([]);
      } finally {
        setCityLoading(false);
      }
    }, 400);
  };

  const toggleFamily = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectAll = () =>
    setSelected(new Set(FAMILIES.map((f) => f.slug)));
  const selectNone = () => setSelected(new Set());

  const canSubmit = selected.size > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      families: new Set(selected),
      city: citySelected,
    });
  };

  // Étiquette synthétique "X / 13 familles sélectionnées" pour feedback rapide.
  const summary = useMemo(() => {
    if (selected.size === FAMILIES.length) return tPicker("allFamilies");
    if (selected.size === 0) return tPicker("noFamilies");
    return tPicker("nFamilies", {
      count: selected.size,
      total: FAMILIES.length,
    });
  }, [selected, tPicker]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="explore-picker-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="relative m-4 flex max-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        {/* Bouton fermer (uniquement si onClose fourni — ex: "Changer ma
            sélection" rouvre le picker, on doit pouvoir annuler). */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={tPicker("close")}
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <div className="flex-1 overflow-auto p-6 sm:p-8">
          <h2
            id="explore-picker-title"
            className="text-2xl font-bold tracking-tight sm:text-3xl"
          >
            {tPicker("title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {tPicker("subtitle")}
          </p>

          {/* Action bar : tout sélectionner / désélectionner + résumé. */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-muted-foreground">
              {summary}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="rounded-md border border-input bg-background px-2.5 py-1 font-medium text-foreground transition hover:bg-accent"
              >
                {tPicker("selectAll")}
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded-md border border-input bg-background px-2.5 py-1 font-medium text-foreground transition hover:bg-accent"
              >
                {tPicker("selectNone")}
              </button>
            </div>
          </div>

          {/* Grille chips familles. Style aligné FamilySwitcher : chip pleine
              quand sélectionnée (couleur famille), outline sinon. */}
          <div
            role="group"
            aria-label={tPicker("familiesLabel")}
            className="mt-3 flex flex-wrap gap-2"
          >
            {FAMILIES.map((f) => {
              const active = selected.has(f.slug);
              const name = tFamilies(f.slug);
              return (
                <button
                  key={f.slug}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => toggleFamily(f.slug)}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition hover:opacity-90"
                  style={
                    active
                      ? {
                          backgroundColor: f.color,
                          color: "white",
                          borderColor: f.color,
                        }
                      : {
                          borderColor: `${f.color}66`,
                          color: f.color,
                        }
                  }
                >
                  <span aria-hidden="true">{f.emoji}</span>
                  {name}
                </button>
              );
            })}
          </div>

          {/* Recherche ville optionnelle. Input + dropdown Nominatim. */}
          <div className="mt-6">
            <label
              htmlFor="explore-picker-city"
              className="text-sm font-semibold"
            >
              {tPicker("cityLabel")}{" "}
              <span className="font-normal text-muted-foreground">
                {tPicker("cityOptional")}
              </span>
            </label>
            <div className="relative mt-2">
              <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
                <Search
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="explore-picker-city"
                  type="search"
                  value={cityQuery}
                  onChange={(e) => handleCityChange(e.target.value)}
                  onFocus={() =>
                    cityResults.length > 0 && setCityDropdownOpen(true)
                  }
                  placeholder={tPicker("cityPlaceholder")}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  aria-autocomplete="list"
                />
                {cityLoading && (
                  <Loader2
                    className="h-4 w-4 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </div>

              {cityDropdownOpen && cityResults.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-lg"
                >
                  {cityResults.map((r, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={citySelected?.name === r.name}
                        onClick={() => {
                          setCitySelected(r);
                          setCityQuery(r.name);
                          setCityDropdownOpen(false);
                        }}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <MapPin
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="line-clamp-2">{r.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {citySelected && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {tPicker("citySelected", { name: citySelected.name })}
              </p>
            )}
          </div>
        </div>

        {/* Footer collé en bas — CTA "Explorer →" en gradient orange/jaune
            (rappel du gradient hero V1). */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-muted/30 px-6 py-4 sm:px-8">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              {tPicker("cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-gradient-to-r from-orange-500 to-yellow-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tPicker("submit")} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
