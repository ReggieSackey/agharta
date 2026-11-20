'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex-api';
import { useState } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { EmptyState } from '@/components/bits';
import Link from 'next/link';

const DOMAINS = ['product', 'engineering', 'business', 'policy', 'personal', 'other'];
const BUDGETS = ['quick', 'standard', 'deep'] as const;

export default function ExperimentsPage() {
  const me = useMutation(api.users.getOrCreateMe);
  useState(() => void me({}));
  const experiments = useQuery(api.experiments.list, {});
  const start = useMutation(api.experiments.start);
  const triggerLearning = useMutation(api.experiments.triggerLearning);

  const [problem, setProblem] = useState('');
  const [domain, setDomain] = useState('other');
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>('standard');
  const [starting, setStarting] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);

  const submit = async () => {
    if (!problem.trim()) return;
    setStarting(true);
    try {
      const res = await start({ problemText: problem, domain, budgetPreset: budget });
      setStartedId(res.experimentId);
      setProblem('');
    } finally {
      setStarting(false);
    }
  };

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold mb-1">Experiments</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-2xl">
        Each problem runs an experimental search: it forms competing hypotheses, investigates
        cross-domain mechanisms, and returns the most novel coherent proposals. Learning runs
        asynchronously afterward and can change future hypothesis selection.
      </p>

      <div className="border rounded-lg p-4 mb-8 bg-neutral-50 space-y-3">
        <textarea
          className="w-full min-h-28 border rounded p-3 text-sm font-mono"
          placeholder="Describe the problem. Include what you've already tried and which conventional approaches you want to move beyond."
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
        />
        <div className="flex gap-3 items-center flex-wrap">
          <select className="border rounded px-2 py-1 text-sm" value={domain} onChange={(e) => setDomain(e.target.value)}>
            {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="border rounded px-2 py-1 text-sm" value={budget} onChange={(e) => setBudget(e.target.value as never)}>
            {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button
            className="bg-neutral-900 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40"
            disabled={starting || !problem.trim()}
            onClick={submit}
          >
            {starting ? 'starting…' : 'Run experiment'}
          </button>
          {startedId && (
            <span className="text-xs text-neutral-500">
              queued —{' '}
              <Link className="underline" href={`/experiments/${startedId}`}>view {startedId.slice(0, 10)}…</Link>
            </span>
          )}
        </div>
      </div>

      {experiments === undefined ? (
        <p className="data-label">loading…</p>
      ) : experiments.length === 0 ? (
        <EmptyState title="No experiments yet" body="Submit a problem above to run your first experimental search." />
      ) : (
        <div className="divide-y border rounded-lg">
          {experiments.map((e) => (
            <Link key={e._id} href={`/experiments/${e._id}`} className="block p-4 hover:bg-neutral-50">
              <div className="flex justify-between items-baseline gap-4">
                <p className="text-sm font-medium truncate">{e.problemText.slice(0, 110)}{e.problemText.length > 110 ? '…' : ''}</p>
                <StatusBadge status={e.status} />
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                {new Date(e.startedAt).toLocaleString()} · {e.finalCount} proposals · policy {e.policyVersionId?.split(':')[0] ?? '—'}
              </p>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <button
          className="text-xs underline text-neutral-500"
          onClick={() => void triggerLearning({})}
        >
          Run Engine 2 learning pass now
        </button>
        <span className="text-xs text-neutral-400"> (also runs automatically after each experiment)</span>
      </div>
    </DashboardShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'completed' ? 'bg-green-100 text-green-800'
    : status === 'failed' ? 'bg-red-100 text-red-800'
    : status === 'queued' || status === 'interpreting' || status === 'hypothesizing' || status === 'investigating' || status === 'evaluating' || status === 'refining'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-neutral-100 text-neutral-700';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>{status}</span>;
}
