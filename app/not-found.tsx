/**
 * 404 GLOBALE (racine) — la page que Next.js prérend en `/_not-found` et que
 * Vercel sert STATIQUEMENT pour toute URL ne matchant aucune route (#655).
 *
 * Pourquoi elle doit exister EN PLUS de `app/[locale]/not-found.tsx` : sans
 * elle, le prérendu `/_not-found` retombe sur la coquille d'erreur par défaut
 * (`__next_error__`) dans le root layout pass-through → page totalement nue
 * (vécu en prod : 404 sans Nav/texte/lien malgré le catch-all [...rest], car
 * Vercel sert le 404 statique SANS invoquer de fonction).
 *
 * Contraintes : le root layout ne fournit ni <html>/<body>, ni CSS global, ni
 * contexte next-intl → page AUTONOME (html/body + styles inline, texte EN
 * statique). Les 404 localisées riches restent servies par
 * `app/[locale]/not-found.tsx` quand un `notFound()` applicatif se déclenche.
 */
export default function RootNotFound() {
  return (
    <html lang="en">
      <head>
        <title>Page not found · Sport Hub</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafaf9",
          color: "#1c1917",
        }}
      >
        <main style={{ textAlign: "center", padding: "2rem" }}>
          <p
            aria-hidden="true"
            style={{ fontSize: "4rem", fontWeight: 700, color: "#d6d3d1", margin: 0 }}
          >
            404
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0.75rem 0 0.5rem" }}>
            Page not found
          </h1>
          <p style={{ color: "#57534e", margin: "0 0 1.5rem" }}>
            The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
          </p>
          <p style={{ display: "flex", gap: "0.75rem", justifyContent: "center", margin: 0 }}>
            <a
              href="/"
              style={{
                background: "#2d7a3e",
                color: "#fff",
                padding: "0.6rem 1.25rem",
                borderRadius: "0.375rem",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              Back to home
            </a>
            <a
              href="/map"
              style={{
                border: "1px solid #d6d3d1",
                color: "#1c1917",
                padding: "0.6rem 1.25rem",
                borderRadius: "0.375rem",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              Open the map
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
