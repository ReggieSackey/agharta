'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';

const DOMAINS = ['product', 'engineering', 'business', 'policy', 'personal', 'other'] as const;
const BUDGETS = [
  { id: 'quick', label: 'Quick', desc: '~8 candidates · 1 generation' },
  { id: 'standard', label: 'Standard', desc: '~24 candidates · up to 2 generations' },
  { id: 'deep', label: 'Deep', desc: '~48 candidates · up to 3 generations' },
] as const;

export default function NewProblemPage() {
  const router = useRouter();
  const identity = useQuery(api.users.me);
  const createProblem = useMutation(api.problems.create);
  const startExploration = useMutation(api.explorations.start);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [constraintsText, setConstraintsText] = useState('');
  const [triedText, setTriedText] = useState('');
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]>('product');
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]['id']>('standard');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const splitLines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identity?.workspaceId) return;
    setSubmitting(true);
    setError(null);
    try {
      const problemId = await createProblem({
        workspaceId: identity.workspaceId,
        title,
        description,
        desiredOutcome: outcome,
        constraints: splitLines(constraintsText),
        domain,
        previouslyTried: splitLines(triedText),
      });
      const { explorationId } = await startExploration({ problemId, budgetPreset: budget });
      router.push(`/explorations/${explorationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create');
      setSubmitting(false);
    }
  }

  return (
    <DashboardShell>
      <h1 className="mb-6 text-xl font-semibold">New problem</h1>
      <form onSubmit={submit} className="max-w-2xl space-y-5">
        <div>
          <label htmlFor="title" className="data-label mb-1 block">title</label>
          <input
            id="title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Support load grows linearly with customers"
            className="w-full rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-blue)]"
          />
        </div>
        <div>
          <label htmlFor="description" className="data-label mb-1 block">description</label>
          <textarea
            id="description"
            required
            maxLength={8000}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is happening, and why is it hard? Include the numbers you know."
            className="w-full rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-blue)]"
          />
        </div>
        <div>
          <label htmlFor="outcome" className="data-label mb-1 block">desired outcome</label>
          <input
            id="outcome"
            required
            maxLength={2000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="e.g. Support cost per customer declining as the base doubles"
            className="w-full rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-blue)]"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="constraints" className="data-label mb-1 block">constraints — one per line</label>
            <textarea
              id="constraints"
              rows={3}
              value={constraintsText}
              onChange={(e) => setConstraintsText(e.target.value)}
              placeholder={'must not degrade SLA commitments\nno new headcount'}
              className="w-full rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-blue)]"
            />
          </div>
          <div>
            <label htmlFor="tried" className="data-label mb-1 block">already tried — one per line</label>
            <textarea
              id="tried"
              rows={3}
              value={triedText}
              onChange={(e) => setTriedText(e.target.value)}
              placeholder={'chatbot deflection\nhelp center articles'}
              className="w-full rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-blue)]"
            />
          </div>
        </div>
        <div>
          <span className="data-label mb-1.5 block">domain</span>
          <div className="flex flex-wrap gap-2">
            {DOMAINS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDomain(d)}
                aria-pressed={domain === d}
                className={`rounded border px-3 py-1.5 text-sm capitalize transition-colors ${
                  domain === d
                    ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]'
                    : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-ink)]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="data-label mb-1.5 block">budget</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {BUDGETS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBudget(b.id)}
                aria-pressed={budget === b.id}
                className={`rounded border p-3 text-left transition-colors ${
                  budget === b.id ? 'border-[var(--color-blue)] bg-white' : 'border-[var(--color-line)] hover:border-[var(--color-blue)]'
                }`}
              >
                <span className="block text-sm font-medium">{b.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{b.desc}</span>
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded border border-[var(--color-terra)] bg-[#fbf4f1] px-3 py-2 text-sm text-[var(--color-terra)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || !identity?.workspaceId}
          className="rounded bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-paper)] transition-colors hover:bg-[var(--color-blue)] disabled:opacity-50"
        >
          {submitting ? 'creating…' : 'Create problem & run exploration →'}
        </button>
      </form>
    </DashboardShell>
  );
}
