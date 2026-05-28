import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Layout admin protégé : check auth + email match ADMIN_EMAIL.
 * Sinon redirect /login?redirect=/admin.
 *
 * MVP : check email simple (one-admin). Plus tard : un rôle `is_admin`
 * dans une table user_profile ou un JWT custom claim.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/admin");
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || user.email !== adminEmail) {
    return (
      <main className="container mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold text-destructive">Accès refusé</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Compte connecté : <code className="text-xs">{user.email}</code>
          <br />
          Compte admin attendu : <code className="text-xs">{adminEmail || "(non configuré)"}</code>
        </p>
        <Link href="/auth/logout" className="mt-6 inline-block text-sm underline">
          Se déconnecter
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-full">
      <div className="border-b bg-muted/30 px-6 py-2 text-xs">
        <div className="container mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="font-semibold hover:underline">
              Admin
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/admin/venues" className="hover:underline">
              Venues
            </Link>
            <Link href="/admin/claim-requests" className="hover:underline">
              Claims
            </Link>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="font-mono">{user.email}</span>
            <Link href="/auth/logout" className="hover:underline">
              déconnexion
            </Link>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
