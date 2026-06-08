/**
 * Section FAQ : 8 Q/R rendues via <details>/<summary> (accordéon natif, pas de JS)
 * + injection JSON-LD FAQPage pour les rich snippets Google.
 *
 * Server Component — i18n via next-intl namespace "faq".
 */
import { getTranslations } from "next-intl/server";
import { jsonLdHtml } from "@/lib/seo/metadata";
import { getTotalSpots } from "@/lib/home-stats";
import { formatCount } from "@/lib/utils";

const QA_KEYS = [
  ["q1", "a1"],
  ["q2", "a2"],
  ["q3", "a3"],
  ["q4", "a4"],
  ["q5", "a5"],
  ["q6", "a6"],
  ["q7", "a7"],
  ["q8", "a8"],
] as const;

type FaqKey = (typeof QA_KEYS)[number][number];

export async function HomeFAQ() {
  const t = await getTranslations("faq");

  // q2 ("D'où viennent les N spots ?") : même total que le H1/meta de la home
  // (getTotalSpots, cache partagé tag "home") → home et FAQ ne divergent jamais
  // (#462 : la FAQ disait "~250 000" alors que la home affiche le vrai total).
  const totalSpots = formatCount(await getTotalSpots());

  const items = QA_KEYS.map(([qKey, aKey]) => ({
    q: qKey === "q2" ? t("q2", { count: totalSpots }) : t(qKey as FaqKey),
    a: t(aKey as FaqKey),
  }));

  // JSON-LD FAQPage : aide Google à afficher la FAQ en rich snippet.
  // Cf. https://developers.google.com/search/docs/appearance/structured-data/faqpage
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <section id="faq" className="border-t">
      <div className="container mx-auto max-w-3xl px-6 py-14">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </div>
        <div className="mt-8 space-y-2">
          {items.map((item, i) => (
            <details
              key={i}
              className="group rounded-md border bg-card px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium md:text-base">
                <span>{item.q}</span>
                <span
                  className="ml-2 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                >
                  ▾
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        // next/script doit être client. Pour un Server Component on injecte
        // directement le JSON-LD (pas de hydratation requise, safe car
        // contenu issu de strings i18n contrôlées par notre repo).
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
      />
    </section>
  );
}
