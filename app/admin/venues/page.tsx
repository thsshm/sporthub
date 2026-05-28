import Link from "next/link";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { formatCount } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Props = { searchParams: { page?: string; q?: string } };

type AdminVenueRow = {
  id: string;
  slug: string;
  name: string;
  family_slug: string;
  source: string;
  is_published: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export default async function AdminVenuesPage({ searchParams }: Props) {
  const sb = getSupabaseAdminClient();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const q = (searchParams.q ?? "").trim();
  const offset = (page - 1) * PAGE_SIZE;

  let query = sb
    .from("venue")
    .select(
      "id, slug, name, family_slug, source, is_published, deleted_at, updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false });

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, count } = await query.range(offset, offset + PAGE_SIZE - 1);
  const venues = (data ?? []) as AdminVenueRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <main className="container mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Venues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(count ?? 0)} au total
            {totalPages > 1 && ` · page ${page} / ${totalPages}`}
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Rechercher…"
            className="rounded-md border px-3 py-1.5 outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 hover:bg-accent"
          >
            Filtrer
          </button>
        </form>
      </header>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Nom</th>
              <th className="pr-3">Famille</th>
              <th className="pr-3">Source</th>
              <th className="pr-3">Publié</th>
              <th className="pr-3">Supprimé</th>
              <th className="pr-3">MAJ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id} className="border-b hover:bg-accent/30">
                <td className="py-2 pr-3 font-medium">{v.name}</td>
                <td className="pr-3">{v.family_slug}</td>
                <td className="pr-3 text-xs text-muted-foreground">{v.source}</td>
                <td className="pr-3">{v.is_published ? "✓" : "—"}</td>
                <td className="pr-3 text-xs">
                  {v.deleted_at ? "⚠️" : "—"}
                </td>
                <td className="pr-3 text-xs text-muted-foreground">
                  {new Date(v.updated_at).toLocaleDateString("fr-FR")}
                </td>
                <td>
                  <Link
                    href={`/venue/${v.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    voir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav
          className="mt-6 flex items-center justify-center gap-4 text-sm"
          aria-label="Pagination"
        >
          {page > 1 && (
            <Link
              href={`/admin/venues?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
            >
              ← Précédent
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/venues?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
            >
              Suivant →
            </Link>
          )}
        </nav>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Édition inline (toggle publish, soft-delete) : à venir dans une issue
        dédiée. Pour l&apos;instant, lecture seule.
      </p>
    </main>
  );
}
