import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ClaimForm } from "./ClaimForm";

type Props = { params: { slug: string } };

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: Props) {
  const sb = getSupabaseServerClient();

  // Vérifie que le venue existe + que l'user est authentifié (RLS le requiert)
  const { data: venue } = await sb
    .from("venue")
    .select("id, name, slug, family_slug")
    .eq("slug", params.slug)
    .eq("is_published", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!venue) notFound();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    redirect(
      `/login?redirect=${encodeURIComponent(`/venue/${params.slug}/claim`)}`,
    );
  }

  return (
    <main className="container mx-auto max-w-lg px-6 py-12">
      <div className="text-sm text-muted-foreground">
        <Link href={`/venue/${venue.slug}`} className="hover:text-foreground">
          ← {venue.name}
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-bold">
        Revendiquer {venue.name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tu es le propriétaire ou le manager de ce lieu ? Soumets une demande, on
        revient vers toi sous 7 jours.
      </p>

      <ClaimForm venueId={venue.id} venueSlug={venue.slug} userEmail={user.email ?? ""} />
    </main>
  );
}
