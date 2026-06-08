"use client";

import { useEffect, useRef } from "react";
import { MapPin, Heart, Globe, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Link,
  usePathname,
  useRouter,
  routing,
  type Locale,
} from "@/i18n/routing";
import { FAMILIES } from "@/lib/families";
import { MobileNav } from "./MobileNav";

const LANG_LABEL: Record<Locale, string> = { fr: "FR", en: "EN", zh: "中" };
const LANG_NATIVE: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  zh: "中文",
};

export function Nav() {
  const t = useTranslations("nav");
  const tFamilies = useTranslations("families");
  const tSports = useTranslations("sports");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const langRef = useRef<HTMLDetailsElement>(null);

  const selectLang = (loc: Locale) => {
    if (langRef.current) langRef.current.open = false;
    if (loc !== locale) router.replace(pathname, { locale: loc });
  };

  // Ferme le menu langue au clic à l'extérieur ou sur Échap.
  useEffect(() => {
    const el = langRef.current;
    if (!el) return;
    const onDocClick = (e: MouseEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") el.open = false;
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /** Tagline = jusqu'à 3 sports principaux concaténés. Évite d'ajouter
   * 13×3 clés i18n statiques pour un sous-titre éditorial. Cf. #131. */
  const taglineFor = (sports: string[]) =>
    sports
      .slice(0, 3)
      .map((s) => {
        try {
          return tSports(s);
        } catch {
          return s.replaceAll("_", " ");
        }
      })
      .join(" · ");

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav
        className="container flex h-16 items-center justify-between gap-4"
        aria-label="Navigation"
      >
        <div className="flex items-center gap-2">
          <MobileNav />
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-foreground hover:text-primary"
            aria-label={t("home")}
          >
            <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-lg">Sport Hub</span>
          </Link>
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          <details className="group relative hidden md:block">
            <summary
              className="flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-haspopup="menu"
            >
              {t("disciplines")}
              <svg
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </summary>
            <div
              className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover p-2 shadow-md"
              role="menu"
              aria-label={t("disciplines")}
            >
              <div className="grid grid-cols-1 gap-0.5">
                {FAMILIES.map((family) => (
                  <Link
                    key={family.slug}
                    href={`/sports/${family.sports[0]}`}
                    role="menuitem"
                    className="group/item flex items-start gap-3 rounded-sm px-2 py-2 text-sm transition-colors"
                    style={{
                      // Hover : background couleur famille à 12% d'opacité
                      // (cf. #131). Injecté via CSS var pour Tailwind hover.
                      ["--family-bg" as string]: `${family.color}1f`,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = `${family.color}1f`)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base"
                      style={{
                        backgroundColor: `${family.color}26`,
                        color: family.color,
                      }}
                    >
                      {family.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {tFamilies(family.slug)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {taglineFor(family.sports)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </details>

          <Link
            href="/map"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:inline"
          >
            {t("map")}
          </Link>

          <Link
            href="/favoris"
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("favorites")}
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">{t("favorites")}</span>
          </Link>

          <details ref={langRef} className="group relative">
            <summary
              className="flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-haspopup="menu"
              aria-label={t("changeLang")}
              title={t("changeLang")}
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              <span>{LANG_LABEL[locale]}</span>
              <svg
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </summary>
            <div
              className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border bg-popover p-1 shadow-md"
              role="menu"
              aria-label={t("changeLang")}
            >
              {routing.locales.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  role="menuitemradio"
                  aria-checked={loc === locale}
                  onClick={() => selectLang(loc)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <span className="w-7 shrink-0 text-xs font-semibold text-muted-foreground">
                    {LANG_LABEL[loc]}
                  </span>
                  <span className="flex-1 text-left">{LANG_NATIVE[loc]}</span>
                  {loc === locale && (
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
