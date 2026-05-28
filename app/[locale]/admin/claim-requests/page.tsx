import Link from "next/link";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ClaimRow = {
  id: string;
  venue_id: string;
  requester_email: string;
  requester_name: string | null;
  requester_role: string | null;
  proof_text: string | null;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  created_at: string;
  venue: { slug: string; name: string } | null;
};

const STATUS_COLOR: Record<ClaimRow["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-green-100 text-green-900",
  rejected: "bg-gray-100 text-gray-600",
};

export default async function ClaimRequestsPage() {
  const sb = getSupabaseAdminClient();

  const { data } = await sb
    .from("claim_request")
    .select(
      "id, venue_id, requester_email, requester_name, requester_role, proof_text, status, notes, created_at, venue:venue_id ( slug, name )",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  // PostgREST renvoie `venue` comme array via la FK ; on flatten en single
  const claims = ((data ?? []) as unknown as Array<Omit<ClaimRow, "venue"> & { venue: ClaimRow["venue"] | ClaimRow["venue"][] }>).map((c) => ({
    ...c,
    venue: Array.isArray(c.venue) ? (c.venue[0] ?? null) : c.venue,
  })) as ClaimRow[];

  return (
    <main className="container mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold">Demandes de claim</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Les 100 plus récentes — modération à venir (PR dédiée pour les actions
        approve/reject).
      </p>

      {claims.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Aucune demande pour l&apos;instant.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {claims.map((c) => (
            <li key={c.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status]}`}
                    >
                      {c.status}
                    </span>
                    {c.venue ? (
                      <Link
                        href={`/venue/${c.venue.slug}`}
                        target="_blank"
                        rel="noopener"
                        className="font-semibold hover:underline"
                      >
                        {c.venue.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        venue supprimée
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">
                    <span className="font-medium">{c.requester_name || "(sans nom)"}</span>{" "}
                    · <code className="text-xs">{c.requester_email}</code>
                    {c.requester_role && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({c.requester_role})
                      </span>
                    )}
                  </p>
                  {c.proof_text && (
                    <p className="mt-2 whitespace-pre-line rounded bg-muted/30 p-2 text-xs">
                      {c.proof_text}
                    </p>
                  )}
                </div>
                <time className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
