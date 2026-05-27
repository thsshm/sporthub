export default function HomePage() {
  return (
    <main className="container mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">SportHub V2</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Scaffold initial en place. Phase 1 — Fondations.
      </p>

      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold">État du projet</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <span className="inline-block w-32 font-mono text-muted-foreground">stack</span>
            Next.js 14 · TypeScript · Tailwind · Supabase · MapLibre
          </li>
          <li>
            <span className="inline-block w-32 font-mono text-muted-foreground">V1 (live)</span>
            <a className="underline" href="https://sporthubmap.com">sporthubmap.com</a> — 267k spots
          </li>
          <li>
            <span className="inline-block w-32 font-mono text-muted-foreground">V2 (en cours)</span>
            ce repo (phase fondations, import DB à venir)
          </li>
        </ul>
      </section>

      <section className="mt-12 space-y-2 text-sm">
        <h2 className="text-xl font-semibold">Docs</h2>
        <p className="text-muted-foreground">
          <code>CLAUDE.md</code> · <code>PRODUCT_SPEC.md</code> · <code>DATA_MODEL.md</code> ·{" "}
          <code>ROADMAP.md</code> · <code>MIGRATION.md</code> · <code>ADR.md</code> ·{" "}
          <code>ISSUES.md</code>
        </p>
      </section>
    </main>
  );
}
