import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildHreflangAlternates } from "@/lib/seo/metadata";
import { getTotalSpots } from "@/lib/home-stats";
import { formatCount } from "@/lib/utils";

// Adresse de contact unique du site (même que la FAQ, /contribute, les fiches).
const CONTACT_EMAIL = "hello@sporthubmap.com";

// Page quasi statique (landing « API à venir ») → revalidate long.
export const revalidate = 86400;

/** Construit un lien mailto avec sujet + corps pré-remplis. */
function mailto(subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encode les espaces en "+", certains clients mail le gèrent
  // mal → on repasse en %20, plus universel pour un mailto.
  return `mailto:${CONTACT_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "developers" });
  const hreflang = buildHreflangAlternates("/developers", locale);
  const count = formatCount(await getTotalSpots());
  return {
    title: t("metaTitle"),
    description: t("metaDescription", { count }),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export default async function DevelopersPage({ params }: { params: { locale: string } }) {
  const { locale } = (await Promise.resolve(params)) as { locale: string };
  setRequestLocale(locale);
  const t = await getTranslations("developers");

  const accessHref = mailto(t("accessMailSubject"), t("accessMailBody"));
  // Compteur dynamique (#557) — même source que la home/FAQ → jamais de chiffre
  // périmé ("250 000+" en dur auparavant).
  const totalSpots = formatCount(await getTotalSpots());
  const plannedItems = ["planned1", "planned2", "planned3", "planned4"] as const;

  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        {t("statusBadge")}
      </span>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">
        {t("intro", { count: totalSpots })}
      </p>

      <section className="mt-10 rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-foreground">{t("plannedHeading")}</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {plannedItems.map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden="true" className="text-primary">
                →
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 flex flex-col rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-foreground">{t("accessHeading")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("accessBody")}</p>
        <a
          href={accessHref}
          className="mt-4 inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("accessCta")}
        </a>
      </section>

      <p className="mt-8 max-w-prose text-sm text-muted-foreground">{t("note")}</p>
    </main>
  );
}
