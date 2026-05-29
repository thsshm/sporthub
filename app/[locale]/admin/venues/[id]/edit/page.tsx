import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { EditVenueForm } from "@/components/admin/EditVenueForm";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

type EditableVenueRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  website_url: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  family_slug: string;
  source: string;
  is_published: boolean;
  deleted_at: string | null;
  updated_at: string;
};

// UUID v4 — simple validation client-side avant de toucher la DB
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminVenueEditPage({ params }: Props) {
  if (!UUID_RE.test(params.id)) {
    notFound();
  }

  const sb = getSupabaseAdminClient();
  const t = await getTranslations("admin.venues.edit");

  const { data, error } = await sb
    .from("venue")
    .select(
      "id, slug, name, description, website_url, phone, address, postal_code, family_slug, source, is_published, deleted_at, updated_at",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const venue = data as EditableVenueRow;

  return (
    <main className="container mx-auto max-w-3xl px-6 py-8">
      <nav className="mb-4 text-xs text-muted-foreground">
        <Link href="/admin/venues" className="hover:underline">
          {t("backToList")}
        </Link>
      </nav>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { name: venue.name })}
        </p>
        {venue.deleted_at && (
          <p className="mt-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
            {t("deletedNotice")}
          </p>
        )}
      </header>

      <EditVenueForm
        venueId={venue.id}
        initial={{
          name: venue.name,
          description: venue.description,
          website_url: venue.website_url,
          phone: venue.phone,
          address: venue.address,
          postal_code: venue.postal_code,
        }}
        disabled={!!venue.deleted_at}
      />
    </main>
  );
}
