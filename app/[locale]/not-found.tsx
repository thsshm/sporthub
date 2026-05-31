import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

// 404 localisée par locale (#108). Sans cette page, /en/inconnu et /zh/inconnu
// retomberaient sur le not-found global (en français), ce qui casse l'UX i18n
// et trompe les crawlers (FR sur une URL /en/ → mauvais signal hreflang).
//
// noindex sur les 404 (recommandation Google : pages d'erreur ne doivent pas
// être indexées). Pas d'alternates hreflang : Google n'indexe pas les 404,
// donc l'overhead n'a aucun intérêt SEO.

export async function generateMetadata(): Promise<Metadata> {
  // Pas de `params` ici : Next.js n'expose pas params à not-found.tsx dans
  // App Router. On utilise getTranslations() sans locale explicite → next-intl
  // résout via setRequestLocale + le layout parent.
  const t = await getTranslations("notFound");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");
  return (
    <main className="container mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40" aria-hidden="true">
        404
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("description")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("backToHome")}
        </Link>
        <Link
          href="/map"
          className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent"
        >
          {t("goToMap")}
        </Link>
      </div>
    </main>
  );
}
