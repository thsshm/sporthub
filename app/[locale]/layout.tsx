import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { FavoritesSyncOnLogin } from "@/components/FavoritesSyncOnLogin";
import { PostHogProvider } from "@/components/PostHogProvider";
import { routing, type Locale } from "@/i18n/routing";
import { buildHreflangAlternates } from "@/lib/seo/metadata";
import "../globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2d7a3e",
  // viewport-fit=cover : permet d'utiliser env(safe-area-inset-*) dans le CSS
  // pour éviter que les overlays bottom soient masqués par la home indicator iOS.
  // Cf. issue #185.
  viewportFit: "cover",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  // hreflang root : same path "/" pour les 3 locales. Les pages enfants
  // surchargent pour leur chemin propre (#108).
  const hreflang = buildHreflangAlternates("/");
  return {
    title: {
      default: `${t("heroTitle")} — ${t("heroSubtitle")}`,
      template: `%s · ${t("heroTitle")}`,
    },
    description: t.has("heroDescription")
      ? t("heroDescription", { count: 350000 })
      : undefined,
    metadataBase: new URL("https://sporthubmap.com"),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Provider analytics PostHog. No-op total sans
              NEXT_PUBLIC_POSTHOG_KEY (pass-through). Issue #96. */}
          <PostHogProvider>
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
            {/* Watcher invisible : sync favoris localStorage → DB au login.
                Issue #91. No UI, juste un useEffect onAuthStateChange. */}
            <FavoritesSyncOnLogin />
          </PostHogProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
