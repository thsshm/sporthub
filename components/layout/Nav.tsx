/**
 * Barre de navigation principale — Server Component.
 * Logo + liens Disciplines + Villes + Favoris (placeholder) + sélecteur langue.
 */
import Link from "next/link";
import { MapPin, Heart, Globe } from "lucide-react";
import { FAMILIES } from "@/lib/families";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav
        className="container flex h-16 items-center justify-between gap-4"
        aria-label="Navigation principale"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-foreground hover:text-primary"
          aria-label="Sport Hub — accueil"
        >
          <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-lg">Sport Hub</span>
        </Link>

        {/* Liens principaux */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* Dropdown Disciplines */}
          <details className="group relative">
            <summary className="hidden cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:flex">
              Disciplines
              <svg
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover p-2 shadow-md">
              <div className="grid grid-cols-1 gap-0.5">
                {FAMILIES.map((family) => (
                  <Link
                    key={family.slug}
                    href={`/sports/${family.sports[0]}`}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span aria-hidden="true">{family.emoji}</span>
                    <span>{family.name_fr}</span>
                  </Link>
                ))}
              </div>
            </div>
          </details>

          {/* Carte */}
          <Link
            href="/map"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Carte
          </Link>

          {/* Favoris placeholder — Phase 3 (auth Supabase) */}
          <Link
            href="/favoris"
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Mes favoris"
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">Favoris</span>
          </Link>

          {/* Sélecteur langue placeholder — Phase 2 (vraies URLs /en/ /zh/) */}
          <button
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Changer de langue"
            title="Internationalisation — à venir"
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">FR</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
