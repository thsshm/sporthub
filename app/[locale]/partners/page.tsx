import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { buildHreflangAlternates } from "@/lib/seo/metadata";

// Adresse de contact unique du site (cf. #467).
const CONTACT_EMAIL = "hello@sporthubmap.com";

// Page éditoriale quasi statique → revalidate long.
export const revalidate = 86400;

/** Lien mailto avec sujet + corps pré-remplis (espaces en %20 pour les clients mail). */
function mailto(subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${CONTACT_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "partners" });
  const hreflang = buildHreflangAlternates("/partners");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export default async function PartnersPage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale } = (await Promise.resolve(params)) as { locale: string };
  setRequestLocale(locale);
  const t = await getTranslations("partners");

  const contactHref = mailto(t("contactSubject"), t("contactBody"));

  const benefits = [
    { icon: "🔎", title: t("b1Title"), body: t("b1Body") },
    { icon: "✏️", title: t("b2Title"), body: t("b2Body") },
    { icon: "🤝", title: t("b3Title"), body: t("b3Body") },
  ];

  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">{t("intro")}</p>

      <div className="mt-10 space-y-4">
        {benefits.map((b) => (
          <section
            key={b.title}
            className="flex gap-4 rounded-lg border p-5"
          >
            <span className="text-2xl" aria-hidden="true">
              {b.icon}
            </span>
            <div>
              <h2 className="font-semibold text-foreground">{b.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <a
          href={contactHref}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("contactCta")}
        </a>
        <Link
          href="/contribute"
          className="inline-flex items-center justify-center rounded-md border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          {t("contributeCta")}
        </Link>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">{t("note")}</p>
    </main>
  );
}
