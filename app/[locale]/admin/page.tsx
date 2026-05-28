import Link from "next/link";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { formatCount } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const sb = getSupabaseAdminClient();

  const [venuesCount, pendingClaimsCount] = await Promise.all([
    sb
      .from("venue")
      .select("id", { count: "exact", head: true })
      .eq("is_published", true)
      .is("deleted_at", null),
    sb
      .from("claim_request")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return (
    <main className="container mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">Dashboard admin</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tableau de bord interne SportHub V2.
      </p>

      <nav className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/venues"
          className="rounded-lg border p-5 transition hover:bg-accent"
        >
          <h2 className="font-semibold">Venues</h2>
          <p className="mt-1 text-2xl font-bold">
            {formatCount(venuesCount.count ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            publiées · gérer la liste
          </p>
        </Link>

        <Link
          href="/admin/claim-requests"
          className="rounded-lg border p-5 transition hover:bg-accent"
        >
          <h2 className="font-semibold">Claims en attente</h2>
          <p className="mt-1 text-2xl font-bold">
            {formatCount(pendingClaimsCount.count ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            à modérer
          </p>
        </Link>
      </nav>
    </main>
  );
}
