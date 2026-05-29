import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { FavoritesSyncOnLogin } from "@/components/FavoritesSyncOnLogin";
import { routing, type Locale } from "@/i18n/routing";
import "../globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2d7a3e",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
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
      canonical: `/${locale === routing.defaultLocale ? "" : locale}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l === routing.defaultLocale ? "" : l}`]),
      ),
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
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
          {/* Watcher invisible : sync favoris localStorage → DB au login.
              Issue #91. No UI, juste un useEffect onAuthStateChange. */}
          <FavoritesSyncOnLogin />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
