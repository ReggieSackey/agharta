import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <header className="mb-16">
        <p className="data-label mb-3">Agharta</p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-ink)]">
          An engine for unconventional thinking.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--color-muted)]">
          Agharta takes a difficult, open-ended problem and searches for useful, meaningfully
          different solutions through multiple creative approaches — then learns which approaches
          tend to work, for which kinds of problems.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="panel p-6">
          <p className="data-label mb-2">01 — Explore</p>
          <h2 className="mb-2 font-medium">Four creative operators</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Divergent generation, cross-domain analogical transfer from a curated concept library,
            constraint inversion with repair, and mechanism recombination. Each idea records its
            full ancestry — which operator made it, from which parents and sources.
          </p>
        </section>
        <section className="panel p-6">
          <p className="data-label mb-2">02 — Evaluate</p>
          <h2 className="mb-2 font-medium">Provisional, honestly labeled</h2>
          <p className="text-sm text-[var(--color-muted)]">
            An independent judge scores every idea on rubric-anchored originality, usefulness, and
            feasibility with explicit uncertainty. These are automated proxies — never confused
            with real outcomes. You mark what actually happened.
          </p>
        </section>
        <section className="panel p-6">
          <p className="data-label mb-2">03 — Adapt</p>
          <h2 className="mb-2 font-medium">A visible learning loop</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Operator allocation shifts with evidence (Bayesian Thompson sampling with a guaranteed
            exploration floor). Strategy challengers run against the champion on fixed benchmark
            problems and are promoted only through a predeclared gate — with your confirmation.
          </p>
        </section>
      </div>

      <section className="panel panel-accent mt-10 p-6">
        <h2 className="mb-2 font-medium">What the scores mean</h2>
        <p className="text-sm text-[var(--color-muted)]">
          1–5 rubric scores are model-judged estimates, each carrying an uncertainty value. A
          &ldquo;promising&rdquo; idea is promising <em>according to an automated rubric</em> — it
          has not been tested in the world. Ideas you mark attempted/succeeded/failed carry real
          outcome evidence and are always displayed as a separate tier.
        </p>
      </section>

      <div className="mt-10 flex items-center gap-4">
        <Link
          href="/login"
          className="rounded border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-paper)] transition-colors hover:bg-[var(--color-blue)]"
        >
          Try Agharta →
        </Link>
        <span className="data-label">sign in required · private by default</span>
      </div>

      <footer className="mt-20 border-t border-[var(--color-line)] pt-6 text-xs text-[var(--color-muted)]">
        Named after the 1975 Miles Davis album. An improvisational design philosophy — no album
        artwork, just the engine.
      </footer>
    </main>
  );
}
