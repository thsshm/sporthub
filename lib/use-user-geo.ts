"use client";

/**
 * Hook MUTUALISÉ de position approximative du visiteur (#703) via `/api/geo`
 * (IP-geo edge, sans permission). Le fetch est mémoïsé au niveau MODULE → une
 * seule requête réseau même avec 24 cards qui montent en même temps. `/api/geo`
 * est de toute façon caché 600 s côté navigateur (Cache-Control private).
 *
 * Renvoie `{ lat, lon }` quand la position est connue, sinon `null` (dev local,
 * IP non géolocalisable, ou erreur réseau). Aucune persistance.
 */
import { useEffect, useState } from "react";

export type UserGeo = { lat: number; lon: number } | null;

let cachedPromise: Promise<UserGeo> | null = null;

function loadGeo(): Promise<UserGeo> {
  if (!cachedPromise) {
    cachedPromise = fetch("/api/geo")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        d?.geo && Number.isFinite(d.geo.lat) && Number.isFinite(d.geo.lon)
          ? { lat: d.geo.lat as number, lon: d.geo.lon as number }
          : null,
      )
      .catch(() => null);
  }
  return cachedPromise;
}

export function useUserGeo(): UserGeo {
  const [geo, setGeo] = useState<UserGeo>(null);
  useEffect(() => {
    let alive = true;
    loadGeo().then((g) => {
      if (alive) setGeo(g);
    });
    return () => {
      alive = false;
    };
  }, []);
  return geo;
}
