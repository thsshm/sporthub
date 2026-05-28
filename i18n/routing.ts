import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["fr", "en", "zh"],
  defaultLocale: "fr",
  // FR sans préfixe (sporthubmap.com/), EN avec /en/, ZH avec /zh/
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

// Wrappers Link/redirect/router qui prennent en compte le locale
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
