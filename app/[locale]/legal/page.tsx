import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildHreflangAlternates } from "@/lib/seo/metadata";

// Adresse de contact unique du site — la même que celle annoncée dans la FAQ
// et utilisée par le lien « Signaler une erreur » des fiches lieu (#467).
// Une seule boîte à créer côté hébergeur, pas de divergence possible.
const CONTACT_EMAIL = "hello@sporthubmap.com";

// Page statique (contenu quasi fixe) — revalidate long.
export const revalidate = 86400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const hreflang = buildHreflangAlternates("/legal");
  return {
    title: t("title"),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
  };
}

export default async function LegalPage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale } = (await Promise.resolve(params)) as { locale: string };
  setRequestLocale(locale);
  const t = await getTranslations("legal");

  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("lastUpdated")}</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {t("editorHeading")}
          </h2>
          <p>{t("editorBody")}</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {t("contactHeading")}
          </h2>
          <p>
            {t("contactBody")}{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {t("hostHeading")}
          </h2>
          <p>{t("hostBody")}</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            {t("dataHeading")}
          </h2>
          <p>{t("dataIntro")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                OpenStreetMap
              </a>{" "}
              — {t("dataOsm")}
            </li>
            <li>
              <a
                href="https://www.wikidata.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Wikidata
              </a>{" "}
              — {t("dataWikidata")}
            </li>
            <li>
              <a
                href="https://overturemaps.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Overture Maps
              </a>{" "}
              — {t("dataOverture")}
            </li>
            <li>
              <a
                href="https://carto.com/attributions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                CARTO
              </a>{" "}
              — {t("dataCarto")}
            </li>
          </ul>
          <p className="mt-4 text-muted-foreground">{t("disclaimer")}</p>
        </section>
      </div>
    </main>
  );
}
