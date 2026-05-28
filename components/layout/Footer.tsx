import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export function Footer() {
  const t = useTranslations("footer");
  const tSports = useTranslations("sports");
  const tMap = useTranslations("map");

  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="container py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* À propos */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">{t("about")}</h3>
            <p className="text-sm text-muted-foreground">{t("aboutText")}</p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">{t("explore")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/map" className="hover:text-foreground">
                  {tMap("title")}
                </Link>
              </li>
              {(["tennis", "padel", "surf", "yoga"] as const).map((slug) => (
                <li key={slug}>
                  <Link
                    href={`/sports/${slug}`}
                    className="hover:text-foreground"
                  >
                    {tSports(slug)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Sources & légal */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">{t("dataLicense")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  OpenStreetMap (ODbL)
                </a>
              </li>
              <li>
                <a
                  href="https://data.sports.gouv.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  RES Étalab
                </a>
              </li>
              <li>
                <a
                  href="https://www.wikidata.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  Wikidata (CC0)
                </a>
              </li>
              <li>
                <Link href="/legal" className="hover:text-foreground">
                  {t("legal")}
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/thsshm/sporthub"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {t("source")}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t pt-6 text-center text-xs text-muted-foreground">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
