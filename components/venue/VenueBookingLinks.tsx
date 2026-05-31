/**
 * Boutons de réservation partenaire sur la fiche venue (issue #209, suite #111).
 * Server Component — pas d'interactivité, juste des liens sortants.
 *
 * Chaque lien pointe vers la route de tracking `/api/go/<booking_link_id>?src=venue_page`
 * (et NON vers l'URL partenaire en direct) : la route décore l'URL avec les UTM
 * SportHub, journalise le clic (table affiliate_click), puis 302 vers le partenaire.
 *
 * `rel="nofollow sponsored"` : lien affilié → on ne transmet pas d'équité SEO et
 * on déclare la relation commerciale (politique Google sur les liens sponsorisés).
 * `target="_blank"` + `noopener` : on garde l'onglet SportHub ouvert.
 */
import { getTranslations } from "next-intl/server";
import type { BookingLink } from "@/lib/supabase/types";

type Props = {
  bookingLinks?: BookingLink[];
};

export async function VenueBookingLinks({ bookingLinks }: Props) {
  const active = (bookingLinks ?? []).filter((b) => b.is_active && b.url);
  if (active.length === 0) return null;

  const t = await getTranslations("venue");

  return (
    <section
      aria-label={t("bookingTitle")}
      className="rounded-lg border bg-card p-4"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("bookingTitle")}
      </h2>
      <div className="flex flex-col gap-2">
        {active.map((link) => (
          <a
            key={link.id}
            href={`/api/go/${link.id}?src=venue_page`}
            target="_blank"
            rel="nofollow sponsored noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            {t("bookOn", { partner: link.partner })}
            <span aria-hidden="true">→</span>
          </a>
        ))}
      </div>
    </section>
  );
}
