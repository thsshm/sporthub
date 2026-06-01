import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { FavoritesSyncOnLogin } from "@/components/FavoritesSyncOnLogin";
import { InstallPwaButton } from "@/components/InstallPwaButton";
import { OfflineBanner } from "@/components/OfflineBanner";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
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
    // PWA iOS (#249) : Next.js génère apple-mobile-web-app-capable,
    // apple-mobile-web-app-status-bar-style, apple-mobile-web-app-title et
    // les <link rel="apple-touch-icon"> à partir de ces champs.
    appleWebApp: {
      capable: true,
      title: "SportHub",
      statusBarStyle: "black-translucent",
    },
    icons: {
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
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
          {/* Enregistre le service worker offline (#249, prod only). */}
          <RegisterServiceWorker />
          {/* Provider analytics PostHog. No-op total sans
              NEXT_PUBLIC_POSTHOG_KEY (pass-through). Issue #96. */}
          <PostHogProvider>
            {/* Bandeau hors-ligne (#249) — au-dessus de la nav. */}
            <OfflineBanner />
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
            {/* Watcher invisible : sync favoris localStorage → DB au login.
                Issue #91. No UI, juste un useEffect onAuthStateChange. */}
            <FavoritesSyncOnLogin />
            {/* Invite à installer la PWA après ≥2 visites (#249). */}
            <InstallPwaButton />
          </PostHogProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
