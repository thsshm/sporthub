import { getTranslations } from "next-intl/server";
import { getUpcomingRetreats, formatRetreatDateRange, formatPriceFrom } from "@/lib/retreats";

/**
 * Panneau « Stages à venir » de la famille retraites (#266).
 *
 * Server Component : interroge `retreat_event` (stages publiés à venir) et rend
 * une grille de cartes. Si la table est vide / pas encore déployée en prod, on
 * dégrade proprement en empty state (aucune erreur visible côté utilisateur).
 *
 * Palier 1 (cette PR) : affichage read-only + lien « Réserver ↗ » externe.
 * L'attribution affiliée (UTM, tracking) est volontairement reportée à #111.
 * Les filtres (hébergement, saison, sports) sont reportés au palier 2.
 */
export async function UpcomingRetreats({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "famille" });

  let retreats: Awaited<ReturnType<typeof getUpcomingRetreats>> = [];
  try {
    retreats = await getUpcomingRetreats();
  } catch {
    // Table absente en prod (0030 pas encore appliquée) → empty state.
    retreats = [];
  }

  return (
    <section className="mt-16" aria-labelledby="stages-heading">
      <h2 id="stages-heading" className="text-2xl font-semibold tracking-tight">
        {t("retraites.stagesTitle")}
      </h2>

      {retreats.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed border-muted p-8 text-center text-muted-foreground">
          <p className="text-lg font-medium">{t("retraites.stagesNone")}</p>
          <p className="mt-1 text-sm">{t("retraites.stagesSoon")}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {retreats.map((r) => {
            const dates = formatRetreatDateRange(r.start_date, r.end_date, locale);
            const price = formatPriceFrom(r.price_from_eur, r.price_currency, locale);
            const place =
              r.venue_external_name ?? [r.city, r.country].filter(Boolean).join(", ");
            return (
              <li key={r.id} className="flex flex-col rounded-xl border bg-card p-5">
                <h3 className="font-medium leading-snug">{r.title}</h3>
                {r.organizer_name && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{r.organizer_name}</p>
                )}

                <dl className="mt-3 space-y-1 text-sm">
                  {dates && <div>📅 {dates}</div>}
                  {place && <div>📍 {place}</div>}
                  {(r.includes_lodging || r.includes_meals) && (
                    <div className="flex flex-wrap gap-x-3 text-muted-foreground">
                      {r.includes_lodging && <span>🛏 {t("retraites.lodging")}</span>}
                      {r.includes_meals && <span>🍽 {t("retraites.meals")}</span>}
                    </div>
                  )}
                </dl>

                <div className="mt-4 flex items-center justify-between gap-3">
                  {price ? (
                    <span className="text-sm font-medium">
                      {t("retraites.from")} {price}
                    </span>
                  ) : (
                    <span aria-hidden />
                  )}
                  {r.booking_url && (
                    <a
                      href={r.booking_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      {t("retraites.book")} ↗
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
