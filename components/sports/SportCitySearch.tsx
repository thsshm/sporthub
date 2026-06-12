"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { useRouter } from "@/i18n/routing";

type CitySuggestion = {
  slug: string;
  name: string;
  country_code: string;
};

type Props = {
  /** Sport courant — sert à construire l'URL /[sport]/[country]/[city]. */
  sportSlug: string;
  placeholder: string;
};

/**
 * Autocomplete « chercher ma ville » sur les pages /sports/[sport] (#640).
 * Interroge /api/cities (notre table `city`, slugs canoniques) et navigue vers
 * la page programmatique sport×ville. Debounce 300ms, min 2 chars, cap 8.
 */
export function SportCitySearch({ sportSlug, placeholder }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const { cities } = (await res.json()) as { cities: CitySuggestion[] };
        setResults(cities);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Click-outside ferme la liste.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const go = (c: CitySuggestion) => {
    setOpen(false);
    setQ("");
    router.push(`/${sportSlug}/${c.country_code.toLowerCase()}/${c.slug}`);
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          aria-label={placeholder}
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
          {results.map((c) => (
            <li key={`${c.country_code}-${c.slug}`}>
              <button
                type="button"
                onClick={() => go(c)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                role="option"
                aria-selected="false"
              >
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{c.name}</span>
                <span className="ml-auto text-xs uppercase text-muted-foreground">
                  {c.country_code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
