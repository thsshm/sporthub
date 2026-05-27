/**
 * Footer — liens, sources de données, licence.
 */
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="container py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* À propos */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">Sport Hub</h3>
            <p className="text-sm text-muted-foreground">
              Une seule carte pour tous tes sports. Données ouvertes, sans pub, sans inscription.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">Explorer</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/map" className="hover:text-foreground">
                  Carte mondiale
                </Link>
              </li>
              <li>
                <Link href="/sports/tennis" className="hover:text-foreground">
                  Tennis
                </Link>
              </li>
              <li>
                <Link href="/sports/padel" className="hover:text-foreground">
                  Padel
                </Link>
              </li>
              <li>
                <Link href="/sports/surf" className="hover:text-foreground">
                  Surf
                </Link>
              </li>
              <li>
                <Link href="/sports/yoga" className="hover:text-foreground">
                  Yoga
                </Link>
              </li>
            </ul>
          </div>

          {/* Sources & légal */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">Données & licence</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  OpenStreetMap (ODbL)
                </a>
              </li>
              <li>
                <a
                  href="https://data.sports.gouv.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  RES Étalab (Etalab)
                </a>
              </li>
              <li>
                <a
                  href="https://www.wikidata.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  Wikidata (CC0)
                </a>
              </li>
              <li>
                <Link href="/legal" className="hover:text-foreground">
                  Mentions légales
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t pt-6 text-center text-xs text-muted-foreground">
          <p>
            &copy; {new Date().getFullYear()} Sport Hub — Licence MIT — Données sous licences
            respectives des sources
          </p>
        </div>
      </div>
    </footer>
  );
}
