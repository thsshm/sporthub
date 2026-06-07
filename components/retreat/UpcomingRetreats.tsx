import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import {
  getUpcomingRetreats,
  formatRetreatDateRange,
  formatPriceFrom,
  RETREAT_SEASONS,
  type RetreatFilters,
  type Season,
} from "@/lib/retreats";

/**
 * Panneau « Stages à venir » de la famille retraites (#266).
 *
 * Server Component : interroge `retreat_event` (stages publiés à venir) et rend
 * une grille de cartes. Empty state propre si la table est vide / pas encore
 * déployée en prod.
 *
 * Palier 1 : affichage read-only + « Réserver ↗ ».
 * Palier 2 (#266) : filtres **saison** + **hébergement** (chips, pilotés par
 * l'URL `?r_season=…&r_lodging=1` → server-rendered, pas de client JS). Les
 * filtres exprimables en SQL passent dans la requête ; la saison est filtrée
 * côté Node (mois d'une colonne DATE). L'attribution affiliée reste #111.
 */

type SearchParams = Record<string, string | undefined>;

const BASE_PATH = "/famille/retraites";

/** Construit un href en repartant des params courants + modifications (vide = retire). */
function buildHref(current: SearchParams, changes: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") params.set(k, v);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === "") params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
}

export async function UpcomingRetreats({
  locale,
  searchParams = {},
}: {
  locale: string;
  searchParams?: SearchParams;
}) {
  const t = await getTranslations({ locale, namespace: "famille" });

  const activeSeason: Season | null = (RETREAT_SEASONS as readonly string[]).includes(
    searchParams.r_season ?? "",
  )
    ? (searchParams.r_season as Season)
    : null;
  const activeLodging = searchParams.r_lodging === "1";
  const filters: RetreatFilters = { season: activeSeason, lodging: activeLodging };

  let retreats: Awaited<ReturnType<typeof getUpcomingRetreats>> = [];
  try {
    retreats = await getUpcomingRetreats(filters);
  } catch {
    retreats = [];
  }

  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active ? "bg-foreground text-background" : "hover:bg-accent"
    }`;

  return (
    <section className="mt-16" aria-labelledby="stages-heading">
      <h2 id="stages-heading" className="text-2xl font-semibold tracking-tight">
        {t("retraites.stagesTitle")}
      </h2>

      {/* Filtres saison + hébergement (#266 palier 2) */}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("retraites.stagesFiltersLabel")}>
        <Link href={buildHref(searchParams, { r_season: undefined })} className={chipClass(!activeSeason)}>
          {t("retraites.filterAllSeasons")}
        </Link>
        {RETREAT_SEASONS.map((s) => (
          <Link key={s} href={buildHref(searchParams, { r_season: s })} className={chipClass(activeSeason === s)}>
            {t(`retraites.season.${s}`)}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Link
          href={buildHref(searchParams, { r_lodging: activeLodging ? undefined : "1" })}
          className={chipClass(activeLodging)}
          aria-pressed={activeLodging}
        >
          🛏 {t("retraites.lodging")}
        </Link>
      </div>

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
