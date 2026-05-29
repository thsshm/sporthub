/**
 * Badge note Google d'une venue — Server Component.
 *
 * Affiche : étoiles visuelles (★★★★☆) + valeur (4.2 / 5) + nombre d'avis.
 * Si pas de `google_rating` dans enrichments, retourne null.
 *
 * Source : Google Places API, cache 30j (cf. enrichment pipeline).
 */
import { getTranslations } from "next-intl/server";
import { Star } from "lucide-react";
import type { VenueDetail } from "@/lib/supabase/types";

type Props = {
  venue: VenueDetail;
};

function Stars({ value }: { value: number }) {
  // 5 étoiles, value entre 0 et 5. On approxime à 0.5 près via deux tracés
  // superposés (gris foncé en fond, jaune en clip).
  const pct = Math.max(0, Math.min(5, value)) / 5;
  return (
    <span
      className="relative inline-flex h-4 w-20 align-middle"
      aria-hidden="true"
    >
      <span className="absolute inset-0 flex text-muted-foreground/40">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="h-4 w-4" fill="currentColor" strokeWidth={0} />
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden text-yellow-500"
        style={{ width: `${pct * 100}%` }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            className="h-4 w-4 shrink-0"
            fill="currentColor"
            strokeWidth={0}
          />
        ))}
      </span>
    </span>
  );
}

export async function VenueReviewBadge({ venue }: Props) {
  const t = await getTranslations("venue");
  const enrichments = venue.enrichments as {
    google_rating?: number;
    google_rating_count?: number;
    google_place_id?: string;
  } | null;
  const rating = enrichments?.google_rating;
  const count = enrichments?.google_rating_count ?? 0;
  if (rating == null) return null;

  const placeId = enrichments?.google_place_id;
  const googleUrl = placeId
    ? `https://search.google.com/local/reviews?placeid=${placeId}`
    : null;

  const badge = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Stars value={rating} />
      <span className="text-sm font-semibold">
        {rating.toFixed(1)}
        <span className="text-muted-foreground"> / 5</span>
      </span>
      {count > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("googleReviewsCount", { count })}
        </span>
      )}
    </span>
  );

  return (
    <section
      className="rounded-lg border bg-card p-3"
      aria-label={t("googleReviewsAria", { rating: rating.toFixed(1), count })}
    >
      {googleUrl ? (
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:opacity-80"
        >
          {badge}
        </a>
      ) : (
        badge
      )}
    </section>
  );
}
