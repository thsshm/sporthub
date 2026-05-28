/**
 * Section "Pourquoi Sport Hub" — 4 engagements.
 * Server Component pur, contenu via next-intl (namespace "howItWorks").
 * Hérite de la section "Vision" de la V1.
 */
import { getTranslations } from "next-intl/server";

type Step = {
  emoji: string;
  titleKey: "step1Title" | "step2Title" | "step3Title" | "step4Title";
  descKey: "step1Desc" | "step2Desc" | "step3Desc" | "step4Desc";
};

const STEPS: Step[] = [
  { emoji: "🗺️", titleKey: "step1Title", descKey: "step1Desc" },
  { emoji: "🎯", titleKey: "step2Title", descKey: "step2Desc" },
  { emoji: "🚫", titleKey: "step3Title", descKey: "step3Desc" },
  { emoji: "🌱", titleKey: "step4Title", descKey: "step4Desc" },
];

export async function HomeHowItWorks() {
  const t = await getTranslations("howItWorks");
  return (
    <section className="border-t bg-muted/10">
      <div className="container mx-auto max-w-6xl px-6 py-14">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div
              key={step.titleKey}
              className="flex flex-col rounded-lg border bg-card p-5"
            >
              <span
                className="text-3xl leading-none"
                aria-hidden="true"
              >
                {step.emoji}
              </span>
              <h3 className="mt-3 text-base font-semibold leading-tight">
                {t(step.titleKey)}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(step.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
