"use client";

/**
 * Bloc d'enrichissement (photo Wikimedia + extrait Wikipedia) affiché en
 * en-tête de la popup map d'un venue (#107).
 *
 * Lazy-fetch via `/api/venue-enrichments/[slug]` au mount — évite de gonfler
 * le payload de `/api/venues` (jusqu'à 2 000 pins par bbox).
 *
 * Gracieux : ne rend RIEN si la requête échoue, est pending, ou ne contient
 * aucun des 3 champs (photo, description, lien). Cela garantit que la popup
 * affiche zéro bloc fantôme pour les venues non enrichis (cf. acceptance).
 */
import { useEffect, useState } from "react";
import { wikimediaThumb, truncate } from "@/lib/venue/wikimedia";

type Enrichments = {
  photo_url?: string;
  description?: string;
  wikipedia_url?: string;
  wikipedia_label?: string;
};

type Props = {
  slug: string;
};

const POPUP_DESC_MAX = 240;
const POPUP_THUMB_PX = 80;
const POPUP_THUMB_WIDTH_REQ = 160; // 2× pour écrans HiDPI

export function VenuePopupEnrichments({ slug }: Props) {
  const [data, setData] = useState<Enrichments | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setHasError(false);
    fetch(`/api/venue-enrichments/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        return res.json() as Promise<Enrichments>;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setHasError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (hasError || !data) return null;

  const photoUrl = wikimediaThumb(data.photo_url, POPUP_THUMB_WIDTH_REQ);
  const description = data.description
    ? truncate(data.description, POPUP_DESC_MAX)
    : null;
  const wikipediaUrl = data.wikipedia_url || null;
  const wikipediaLabel = data.wikipedia_label?.trim() || null;

  // Si aucun champ enrichi → pas de bloc.
  if (!photoUrl && !description && !wikipediaUrl) return null;

  return (
    <div className="space-y-1.5 border-b border-gray-100 pb-2">
      {(photoUrl || description) && (
        <div className="flex gap-2">
          {photoUrl && (
            // Utilisation de <img> plutôt que next/image : la popup MapLibre
            // est rendue hors du flux React standard et next/image peut
            // mal mesurer le layout. Une vignette 80×80 reste légère.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              width={POPUP_THUMB_PX}
              height={POPUP_THUMB_PX}
              loading="lazy"
              decoding="async"
              className="h-20 w-20 shrink-0 rounded object-cover"
            />
          )}
          {description && (
            <p className="line-clamp-4 text-xs leading-snug text-gray-700">
              {description}
            </p>
          )}
        </div>
      )}
      {wikipediaUrl && (
        <a
          href={wikipediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:underline"
        >
          <span aria-hidden="true">📖</span>
          <span>{wikipediaLabel || "Wikipedia"}</span>
          <span aria-hidden="true">↗</span>
        </a>
      )}
    </div>
  );
}
