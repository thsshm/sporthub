"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { useTranslations } from "next-intl";

export type SearchResult = {
  display_name: string;
  lat: number;
  lon: number;
};

type NominatimRow = {
  display_name: string;
  lat: string;
  lon: string;
};

type Props = {
  onSelect: (r: SearchResult) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Recherche de ville via Nominatim (OSM, public, sans clé).
 * Debounced 400ms, min 3 chars. Limité à 5 résultats.
 *
 * Nominatim policy : User-Agent identifiant + max ~1 req/sec.
 * Pour de gros volumes, basculer sur Mapbox/MapTiler Geocoding (issue future).
 */
export function SearchBar({ onSelect, placeholder, className }: Props) {
  const tMap = useTranslations("map");
  const ph = placeholder ?? tMap("searchPlaceholder");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fetch debounced
  useEffect(() => {
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&accept-language=fr`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as NominatimRow[];
        setResults(
          data.map((r) => ({
            display_name: r.display_name,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
          }))
        );
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  // Click-outside ferme la liste
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    // NB: pas de `relative` codé en dur ici — le parent passe souvent un
    // `absolute …` via className (cf. MapWithSearch), et `.relative` étant
    // défini après `.absolute` dans Tailwind, il écrasait le positionnement
    // (barre collée en haut-gauche au lieu de top-right). On laisse le parent
    // choisir `position` ; le menu déroulant ci-dessous reste ancré car son
    // conteneur est positionné dans tous les cas.
    <div ref={wrapperRef} className={className ?? "relative"}>
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={ph}
          aria-label={ph}
          aria-autocomplete="list"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            …
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-lg"
          role="listbox"
        >
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQ("");
                  setOpen(false);
                  setResults([]);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                role="option"
                aria-selected="false"
              >
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="line-clamp-2">{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
