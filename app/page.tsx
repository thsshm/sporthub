import Link from "next/link";
import { MapPin } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FAMILIES } from "@/lib/families";
import { formatCount } from "@/lib/utils";

export const revalidate = 3600;

async function fetchFamilyCounts(): Promise<Record<string, number>> {
  const sb = getSupabaseServerClient();
  const entries = await Promise.all(
    FAMILIES.map(async (f) => {
      const { count } = await sb
        .from("venue")
        .select("id", { count: "exact", head: true })
        .eq("family_slug", f.slug)
        .eq("is_published", true)
        .is("deleted_at", null);
      return [f.slug, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export default async function HomePage() {
  const counts = await fetchFamilyCounts();
  const totalVenues = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/40 to-background">
        <div className="container mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Sport Hub
          </h1>
          <p className="mt-3 text-lg text-muted-foreground md:text-xl">
            Une seule carte pour tous tes sports.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatCount(totalVenues)} spots
            </span>{" "}
            dans 13 familles, partout dans le monde. Données ouvertes, sans pub,
            sans inscription.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/map"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Explorer la carte
            </Link>
            <Link
              href="/sports/tennis"
              className="inline-flex items-center rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              Liste par sport
            </Link>
          </div>
        </div>
      </section>

      {/* Grille familles */}
      <section className="container mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight">
          Explorer par famille
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          13 familles de sport · cliquez pour voir la liste complète
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FAMILIES.map((family) => {
            const count = counts[family.slug] ?? 0;
            const hasVenues = count > 0;
            return (
              <Link
                key={family.slug}
                href={`/sports/${family.sports[0]}`}
                className="group block overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
              >
                <div
                  className="h-1.5"
                  style={{ backgroundColor: family.color }}
                  aria-hidden="true"
                />
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl leading-none" aria-hidden="true">
                      {family.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold leading-tight group-hover:underline">
                        {family.name_fr}
                      </h3>
                      <p
                        className={`mt-0.5 text-xs ${hasVenues ? "text-muted-foreground" : "text-muted-foreground/60"}`}
                      >
                        {hasVenues ? (
                          <>
                            <span className="font-semibold text-foreground">
                              {formatCount(count)}
                            </span>{" "}
                            spots
                          </>
                        ) : (
                          "à venir"
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Données ouvertes */}
      <section className="border-t bg-muted/20">
        <div className="container mx-auto max-w-4xl px-6 py-10 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Données ouvertes
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Sources :{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              OpenStreetMap (ODbL)
            </a>{" "}
            ·{" "}
            <a
              href="https://data.sports.gouv.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              RES Étalab
            </a>{" "}
            ·{" "}
            <a
              href="https://www.wikidata.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Wikidata (CC0)
            </a>
            . Géolocalisation PostGIS · clusterisation Supercluster · carte
            MapLibre GL.
          </p>
        </div>
      </section>
    </>
  );
}
