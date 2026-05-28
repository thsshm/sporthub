/**
 * Section "Recherches populaires" — liens vers les pages programmatiques
 * sport × ville (boost SEO interne + utile pour l'user).
 *
 * Liste statique des combinaisons les plus pertinentes (héritée du POC V1
 * `scripts/programmatic/build.py`). Évite une query DB — on assume que ces
 * combos existent ; le clic mène à la page qui se chargera de rendre.
 *
 * Server Component, i18n via "popularSearches" + "sports".
 */
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

type Combo = {
  sport: string;
  citySlug: string;
  cityLabel: string;
};

const POPULAR_COMBOS: Combo[] = [
  { sport: "padel", citySlug: "paris", cityLabel: "Paris" },
  { sport: "tennis", citySlug: "lyon", cityLabel: "Lyon" },
  { sport: "petanque", citySlug: "marseille", cityLabel: "Marseille" },
  { sport: "yoga", citySlug: "bordeaux", cityLabel: "Bordeaux" },
  { sport: "gym", citySlug: "toulouse", cityLabel: "Toulouse" },
  { sport: "boxing", citySlug: "nantes", cityLabel: "Nantes" },
  { sport: "padel", citySlug: "nice", cityLabel: "Nice" },
  { sport: "tennis", citySlug: "strasbourg", cityLabel: "Strasbourg" },
  { sport: "surf", citySlug: "biarritz", cityLabel: "Biarritz" },
  { sport: "kitesurf", citySlug: "la-rochelle", cityLabel: "La Rochelle" },
  { sport: "football", citySlug: "lille", cityLabel: "Lille" },
  { sport: "basketball", citySlug: "rennes", cityLabel: "Rennes" },
];

export async function HomePopularSearches() {
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
          {POPULAR_COMBOS.map((c) => {
            const sportLabel = tSports.has(c.sport) ? tSports(c.sport) : c.sport;
            return (
              <li key={`${c.sport}-${c.citySlug}`}>
                <Link
                  href={`/${c.sport}/fr/${c.citySlug}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{sportLabel}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{c.cityLabel}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
