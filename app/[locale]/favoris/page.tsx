/**
 * Page /favoris — Server Component.
 *
 * Issue #91 (phase 3).
 *
 * Fonctionnement :
 *   - SSR : on récupère côté server l'user via Supabase server client,
 *     puis on charge en SQL ses favoris + détails venue (nom, slug, ville…).
 *   - Si pas auth → état "connecte-toi" avec lien vers /login.
 *   - Si auth + 0 favoris → empty state.
 *   - Si auth + N favoris → grid de VenueCard (composant existant).
 *
 * Note : on ne va PAS taper /api/favorites depuis le server (pas nécessaire),
 *   on lit la DB en direct via le server client. La RLS s'assure qu'on ne
 *   voit que les rows de l'user. Bonus : un seul aller-retour SQL au lieu
 *   de deux (favoris puis venues).
 *
 * Fallback localStorage : non gérée côté SSR (le server ne voit pas le
 *   localStorage). Le contenu local est migré au login via le watcher
 *   `FavoritesSyncOnLogin` dans le layout — donc dès que l'user a un compte,
 *   ses favoris sont en DB et cette page les affiche correctement.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { VenueCard } from "@/components/venue/VenueCard";
import type { VenuePin } from "@/lib/supabase/types";

type Props = {
  params: Promise<{ locale: string }>;
};

export const dynamic = "force-dynamic"; // dépend de la session → pas de cache

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "favorites" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false }, // page privée → pas d'indexation
  };
}

type FavoriteVenueRow = {
  venue_id: string;
  created_at: string;
  venue:
    | (Pick<
        VenuePin,
        "id" | "slug" | "name" | "lat" | "lon" | "family_slug" | "primary_sport_slug"
      > & {
        address: string | null;
        country_code: string | null;
        courts_count: number | null;
        city: { name: string; country_code: string } | null;
      })
    | null;
};

export default async function FavorisPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("favorites");

  const sb = getSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-4 text-muted-foreground">{t("loginRequired")}</p>
        <Link
          href="/login?redirect=/favoris"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("loginCta")}
        </Link>
      </main>
    );
  }

  // RLS filtre déjà par user_id → pas besoin de .eq("user_id", user.id).
  // Join venue pour avoir les champs nécessaires au rendu de VenueCard.
  // Filtre côté lecture sur is_published + deleted_at pour éviter d'afficher
  // une venue dépubliée (la RLS de venue les bloque déjà côté SELECT, mais
  // explicite = robustesse si la policy change un jour).
  const { data, error } = await sb
    .from("user_favorite")
    .select(
      `
      venue_id,
      created_at,
      venue:venue_id (
        id, slug, name, lat, lon, family_slug, primary_sport_slug,
        address, country_code, courts_count,
        city:city_id ( name, country_code )
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-4 text-red-700">{t("errorLoading")}</p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as FavoriteVenueRow[];
  const venues = rows
    .map((row) => row.venue)
    .filter((v): v is NonNullable<FavoriteVenueRow["venue"]> => v !== null)
    .map((v) => ({
      ...v,
      city_name: v.city?.name,
      country_code: v.country_code ?? v.city?.country_code ?? undefined,
      // sport_slugs vide ici — on ne fait pas le M:N join pour rester léger.
      // VenueCard tolère un sport_slugs absent (cf. ligne 67 du composant).
    }));

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <header className="border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">
          {t("count", { count: venues.length })}
        </p>
      </header>

      {venues.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">{t("empty")}</p>
          <Link
            href="/map"
            className="mt-6 inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {t("exploreMap")}
          </Link>
        </div>
      ) : (
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <VenueCard key={venue.id} venue={venue} />
          ))}
        </section>
      )}
    </main>
  );
}
