import Link from "next/link";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { formatCount } from "@/lib/utils";
import { togglePublish, softDelete, restore } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Props = { searchParams: { page?: string; q?: string; show_deleted?: string } };

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
  const showDeleted = searchParams.show_deleted === "1";
  const offset = (page - 1) * PAGE_SIZE;

  let query = sb
    .from("venue")
    .select(
      "id, slug, name, family_slug, source, is_published, deleted_at, updated_at",
      { count: "exact" },
    )
    .order("id", { ascending: false }); // updated_at pas indexé → trop lent sur 348k rows

  if (q) query = query.ilike("name", `%${q}%`);
  if (!showDeleted) query = query.is("deleted_at", null);

  const { data, count } = await query.range(offset, offset + PAGE_SIZE - 1);
  const venues = (data ?? []) as AdminVenueRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const buildHref = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      page: String(page),
      q: q || undefined,
      show_deleted: showDeleted ? "1" : undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) {
      if (v == null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/admin/venues?${qs}` : "/admin/venues";
  };

  return (
    <main className="container mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Venues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(count ?? 0)}
            {totalPages > 1 && ` · page ${page} / ${totalPages}`}
            {showDeleted && " · supprimés inclus"}
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Rechercher…"
            className="rounded-md border px-3 py-1.5 outline-none focus:border-primary"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="show_deleted"
              value="1"
              defaultChecked={showDeleted}
            />
            Inclure supprimés
          </label>
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 hover:bg-accent"
          >
            Filtrer
          </button>
        </form>
      </header>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Nom</th>
              <th className="pr-3">Famille</th>
              <th className="pr-3">Source</th>
              <th className="pr-3">État</th>
              <th className="pr-3">MAJ</th>
              <th className="pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => {
              const isDeleted = !!v.deleted_at;
              return (
                <tr
                  key={v.id}
                  className={`border-b hover:bg-accent/30 ${isDeleted ? "opacity-50" : ""}`}
                >
                  <td className="py-2 pr-3 font-medium">
                    <Link
                      href={`/venue/${v.slug}`}
                      target="_blank"
                      rel="noopener"
                      className="hover:underline"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="pr-3">{v.family_slug}</td>
                  <td className="pr-3 text-xs text-muted-foreground">
                    {v.source}
                  </td>
                  <td className="pr-3 text-xs">
                    {isDeleted ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-900">
                        supprimé
                      </span>
                    ) : v.is_published ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-900">
                        publié
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                        brouillon
                      </span>
                    )}
                  </td>
                  <td className="pr-3 text-xs text-muted-foreground">
                    {new Date(v.updated_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {isDeleted ? (
                        <form action={restore.bind(null, v.id)}>
                          <button
                            type="submit"
                            className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-900 hover:bg-blue-100"
                          >
                            Restaurer
                          </button>
                        </form>
                      ) : (
                        <>
                          <form
                            action={togglePublish.bind(null, v.id, v.is_published)}
                          >
                            <button
                              type="submit"
                              className="rounded border px-2 py-0.5 text-xs hover:bg-accent"
                            >
                              {v.is_published ? "Dépublier" : "Publier"}
                            </button>
                          </form>
                          <form action={softDelete.bind(null, v.id)}>
                            <button
                              type="submit"
                              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-900 hover:bg-red-100"
                            >
                              Supprimer
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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
              href={buildHref({ page: String(page - 1) })}
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
              href={buildHref({ page: String(page + 1) })}
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
            >
              Suivant →
            </Link>
          )}
        </nav>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Édition complète (name/description/contacts) : à venir dans une PR
        dédiée.
      </p>
    </main>
  );
}
