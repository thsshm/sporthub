import { getLocale, getTranslations } from "next-intl/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { formatCount } from "@/lib/utils";
import type { AffiliateClick, Partner } from "@/lib/supabase/types";

/**
 * Dashboard partenaires — clics affiliés (issue #111, part 2/2).
 * Lecture via service_role (la table affiliate_click est deny-all en RLS).
 *
 * Agrégats : total, clics par partenaire, et les 50 clics les plus récents.
 * Volontairement simple (pas de graphe/date-range picker) — suffit à valider
 * que le tracking remonte. L'enrichissement (séries temporelles, filtres,
 * export CSV) viendra si le besoin se confirme côté business.
 */
export const dynamic = "force-dynamic";

const LOCALE_TO_BCP47: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  zh: "zh-CN",
};

const RECENT_LIMIT = 50;

export default async function AffiliateDashboardPage() {
  const sb = getSupabaseAdminClient();
  const t = await getTranslations("admin.affiliate");
  const locale = await getLocale();
  const dateLocale = LOCALE_TO_BCP47[locale] ?? "fr-FR";

  const [{ count: totalCount }, { data: recentRaw }, { data: partnersRaw }] =
    await Promise.all([
      sb.from("affiliate_click").select("id", { count: "exact", head: true }),
      sb
        .from("affiliate_click")
        .select(
          "id, booking_link_id, partner, venue_id, source, ip_hash, user_agent, referer, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      sb
        .from("partner")
        .select("slug, name, affiliate_id, commission_rate, is_active, created_at, updated_at")
        .order("name", { ascending: true }),
    ]);

  const recent = (recentRaw ?? []) as AffiliateClick[];
  const partners = (partnersRaw ?? []) as Partner[];

  // Agrégat "clics par partenaire" sur l'échantillon récent. Pour un compte
  // exact par partenaire à grande échelle, il faudrait une vue SQL agrégée ;
  // ici on reste sur l'échantillon affiché (cf. note de cap ci-dessous).
  const byPartner = new Map<string, number>();
  for (const c of recent) {
    byPartner.set(c.partner, (byPartner.get(c.partner) ?? 0) + 1);
  }
  const partnerRows = Array.from(byPartner.entries()).sort((a, b) => b[1] - a[1]);

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <main className="container mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-6 rounded-lg border p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("totalLabel")}
        </p>
        <p className="mt-1 text-3xl font-bold">
          {formatCount(totalCount ?? 0)}
        </p>
      </div>

      {/* Référentiel des partenaires + statut du deal d'affiliation. */}
      {partners.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("partnersTitle", { count: partners.length })}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("colPartner")}</th>
                  <th className="px-4 py-2 font-medium">{t("colDeal")}</th>
                  <th className="px-4 py-2 font-medium">{t("colCommission")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {partners.map((p) => (
                  <tr key={p.slug} className={p.is_active ? "" : "opacity-50"}>
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">
                      {p.affiliate_id ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
                          {t("dealSigned")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {t("dealPending")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {p.commission_rate != null
                        ? `${(p.commission_rate * 100).toFixed(2)} %`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {recent.length === 0 ? (
        <p className="mt-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("byPartnerTitle", { count: recent.length })}
            </h2>
            <ul className="mt-3 divide-y rounded-lg border">
              {partnerRows.map(([partner, n]) => (
                <li
                  key={partner}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{partner}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCount(n)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("recentTitle", { count: recent.length })}
            </h2>
            <div className="mt-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t("colDate")}</th>
                    <th className="px-4 py-2 font-medium">{t("colPartner")}</th>
                    <th className="px-4 py-2 font-medium">{t("colSource")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {fmtDate(c.created_at)}
                      </td>
                      <td className="px-4 py-2 font-medium">{c.partner}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.source ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
