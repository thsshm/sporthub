import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { formatCount } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const sb = getSupabaseAdminClient();
  const t = await getTranslations("admin.dashboard");

  const [venuesCount, pendingClaimsCount, affiliateClicksCount] =
    await Promise.all([
      sb
        .from("venue")
        .select("id", { count: "exact", head: true })
        .eq("is_published", true)
        .is("deleted_at", null),
      sb
        .from("claim_request")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      sb.from("affiliate_click").select("id", { count: "exact", head: true }),
    ]);

  return (
    <main className="container mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>

      <nav className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/venues"
          className="rounded-lg border p-5 transition hover:bg-accent"
        >
          <h2 className="font-semibold">{t("venuesTitle")}</h2>
          <p className="mt-1 text-2xl font-bold">
            {formatCount(venuesCount.count ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("venuesHint")}
          </p>
        </Link>

        <Link
          href="/admin/claim-requests"
          className="rounded-lg border p-5 transition hover:bg-accent"
        >
          <h2 className="font-semibold">{t("claimsTitle")}</h2>
          <p className="mt-1 text-2xl font-bold">
            {formatCount(pendingClaimsCount.count ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("claimsHint")}</p>
        </Link>

        <Link
          href="/admin/affiliate"
          className="rounded-lg border p-5 transition hover:bg-accent"
        >
          <h2 className="font-semibold">{t("affiliateTitle")}</h2>
          <p className="mt-1 text-2xl font-bold">
            {formatCount(affiliateClicksCount.count ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("affiliateHint")}
          </p>
        </Link>
      </nav>
    </main>
  );
}
