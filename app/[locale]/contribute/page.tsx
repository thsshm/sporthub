import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildHreflangAlternates } from "@/lib/seo/metadata";

// Boîte de contact communautaire (même alias que la page légale #472).
const CONTACT_EMAIL = "contact@sporthubmap.com";

// Page quasi statique → revalidate long.
export const revalidate = 86400;

/** Construit un lien mailto avec sujet + corps pré-remplis. */
function mailto(subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encode les espaces en "+", certains clients mail le
  // gèrent mal → on repasse en %20, plus universel pour un mailto.
  return `mailto:${CONTACT_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contribute" });
  const hreflang = buildHreflangAlternates("/contribute");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export default async function ContributePage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale } = (await Promise.resolve(params)) as { locale: string };
  setRequestLocale(locale);
  const t = await getTranslations("contribute");

  const addHref = mailto(t("addMailSubject"), t("addMailBody"));
  const reportHref = mailto(t("reportMailSubject"), t("reportMailBody"));

  const ctaClass =
    "mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">{t("intro")}</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <section className="flex flex-col rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("addHeading")}
          </h2>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">
            {t("addBody")}
          </p>
          <a href={addHref} className={ctaClass}>
            {t("addCta")}
          </a>
        </section>

        <section className="flex flex-col rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("reportHeading")}
          </h2>
          <p className="mt-2 flex-1 text-sm text-muted-foreground">
            {t("reportBody")}
          </p>
          <a href={reportHref} className={ctaClass}>
            {t("reportCta")}
          </a>
        </section>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">{t("note")}</p>
    </main>
  );
}
