"use client";

/**
 * Bouton étoile favori — composant client réutilisable (issue #91).
 *
 * - Authentifié → POST/DELETE /api/favorites (persisté en DB, RLS-protégé).
 * - Non authentifié → fallback localStorage (clé `sporthub-favorites`,
 *   compatible avec le code existant dans MapClient.tsx).
 *
 * Branché dans VenueCard. La popup MapClient existante garde son inlined
 * pour l'instant — refacto séparé pour ne pas entrer en conflit avec
 * la PR #140 qui touche aussi MapClient.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const FAVORITES_KEY = "sporthub-favorites";

type Props = {
  venueId: string;
  venueSlug: string;
  initialFavorite?: boolean;
  className?: string;
  labelAdd?: string;
  labelRemove?: string;
};

function readLocal(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeLocal(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* silent */
  }
}

export function FavoriteButton({
  venueId,
  venueSlug,
  initialFavorite,
  className,
  labelAdd = "Ajouter aux favoris",
  labelRemove = "Retirer des favoris",
}: Props) {
  const [isFav, setIsFav] = useState<boolean>(initialFavorite ?? false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    void (async () => {
      const {
        data: { user },
      } = await sb.auth.getUser();
      setAuthed(!!user);

      if (initialFavorite !== undefined) return;

      if (!user) {
        setIsFav(readLocal().has(venueSlug));
        return;
      }

      try {
        const res = await fetch("/api/favorites");
        if (!res.ok) return;
        const json = (await res.json()) as {
          favorites?: Array<{ venue_id: string }>;
        };
        const set = new Set(json.favorites?.map((f) => f.venue_id) ?? []);
        setIsFav(set.has(venueId));
      } catch {
        /* silent */
      }
    })();
  }, [venueId, venueSlug, initialFavorite]);

  const toggle = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const next = !isFav;
    setIsFav(next); // optimistic

    try {
      if (authed) {
        const res = await fetch("/api/favorites", {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venue_id: venueId }),
        });
        if (!res.ok) setIsFav(!next); // rollback
      } else {
        const set = readLocal();
        if (next) set.add(venueSlug);
        else set.delete(venueSlug);
        writeLocal(set);
      }
    } finally {
      setPending(false);
    }
  }, [authed, isFav, pending, venueId, venueSlug]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      aria-label={isFav ? labelRemove : labelAdd}
      aria-pressed={isFav}
      disabled={pending}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-yellow-500 disabled:opacity-50 ${className ?? ""}`}
    >
      <Star
        className="h-5 w-5"
        fill={isFav ? "currentColor" : "none"}
        color={isFav ? "#eab308" : "currentColor"}
      />
    </button>
  );
}
