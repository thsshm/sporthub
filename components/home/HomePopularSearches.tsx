/**
 * Section "Recherches populaires" — liens vers les pages programmatiques
 * sport × ville (boost SEO interne + utile pour l'user).
 *
 * DATA-DRIVEN (#462) : la liste éditoriale est filtrée par le vrai nombre de
 * lieux publiés (≥ MIN_VENUES_FOR_POPULAR) via getPopularCombos → on n'affiche
 * jamais un lien menant à une page vide (« No address »). Si aucun combo ne
 * qualifie, la section entière est masquée.
 *
 * Server Component, i18n via "popularSearches" + "sports".
 */
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getPopularCombos, HIGH_COVERAGE_FOR_POPULAR } from "@/lib/home-stats";

export async function HomePopularSearches() {
  const combos = await getPopularCombos();
  if (combos.length === 0) return null;

  const t = await getTranslations("popularSearches");
  const tSports = await getTranslations("sports");

  return (
    <section className="border-t bg-muted/10">
      <div className="container mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
          <Link
            href="/map"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("viewAll")} →
          </Link>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2">
          {combos.map((c) => {
            const sportLabel = tSports.has(c.sport) ? tSports(c.sport) : c.sport;
            return (
              <li key={`${c.sport}-${c.citySlug}`}>
                <Link
                  href={`/${c.sport}/fr/${c.citySlug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{sportLabel}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{c.cityLabel}</span>
                  {/* Nombre de lieux fiables → la recherche paraît curée (#614). */}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {t("venuesCount", { count: c.count })}
                  </span>
                  {c.count >= HIGH_COVERAGE_FOR_POPULAR && (
                    <span
                      className="text-emerald-600 dark:text-emerald-400"
                      title={t("highCoverage")}
                      aria-label={t("highCoverage")}
                    >
                      ★
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
