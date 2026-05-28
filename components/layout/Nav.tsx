"use client";

import { MapPin, Heart, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter, type Locale } from "@/i18n/routing";
import { FAMILIES } from "@/lib/families";
import { MobileNav } from "./MobileNav";

const LANG_LABEL: Record<Locale, string> = { fr: "FR", en: "EN", zh: "中" };
const LANG_CYCLE: Record<Locale, Locale> = { fr: "en", en: "zh", zh: "fr" };

export function Nav() {
  const t = useTranslations("nav");
  const tFamilies = useTranslations("families");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const toggleLang = () => {
    router.replace(pathname, { locale: LANG_CYCLE[locale] });
  };

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
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
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
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-2 shadow-md">
              <div className="grid grid-cols-1 gap-0.5">
                {FAMILIES.map((family) => (
                  <Link
                    key={family.slug}
                    href={`/sports/${family.sports[0]}`}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span aria-hidden="true">{family.emoji}</span>
                    <span>{tFamilies(family.slug)}</span>
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

          <button
            type="button"
            onClick={toggleLang}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("changeLang")}
            title={`${LANG_LABEL[locale]} → ${LANG_LABEL[LANG_CYCLE[locale]]}`}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
            <span>{LANG_LABEL[locale]}</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
