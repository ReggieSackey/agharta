'use client';

import { use, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EvidenceChip } from '@/components/bits';
import Link from 'next/link';

export default function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useQuery(api.problems.get, { problemId: id as never });
  const start = useMutation(api.explorations.start);
  const [starting, setStarting] = useState(false);

  if (data === undefined) {
    return (
      <DashboardShell>
        <p className="data-label">loading…</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="data-label mb-1">{data.problem.domain}</p>
          <h1 className="text-xl font-semibold">{data.problem.title}</h1>
        </div>
        <button
          onClick={async () => {
            setStarting(true);
            try {
              const { explorationId } = await start({ problemId: data.problem._id });
              window.location.href = `/explorations/${explorationId}`;
            } finally {
              setStarting(false);
            }
          }}
          disabled={starting}
          className="rounded bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-paper)] disabled:opacity-50"
        >
          {starting ? 'starting…' : 'Run new exploration'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <p className="data-label mb-2">description</p>
          <p className="whitespace-pre-wrap text-sm">{data.problem.description}</p>
          <p className="data-label mb-2 mt-4">desired outcome</p>
          <p className="text-sm">{data.problem.desiredOutcome}</p>
          {data.problem.constraints && data.problem.constraints.length > 0 && (
            <>
              <p className="data-label mb-2 mt-4">constraints</p>
              <ul className="list-inside list-disc text-sm text-[var(--color-muted)]">
                {data.problem.constraints.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </>
          )}
        </section>
        <section>
          <p className="data-label mb-2">exploration runs</p>
          {data.explorations.length === 0 ? (
            <p className="panel px-4 py-6 text-center text-sm text-[var(--color-muted)]">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.explorations.map((ex) => (
                <li key={ex._id}>
                  <Link href={`/explorations/${ex._id}`} className="panel block px-4 py-3 hover:border-[var(--color-blue)]">
                    <div className="flex items-center justify-between gap-2">
                      <EvidenceChip kind={ex.status} />
                      <span className="data-label">{new Date(ex._creationTime).toLocaleString()}</span>
                    </div>
                    {ex.progress !== undefined && ex.status === 'running' && (
                      <div className="mt-2 h-1 rounded bg-[var(--color-line)]">
                        <div className="h-1 rounded bg-[var(--color-blue)]" style={{ width: `${Math.round((ex.progress ?? 0) * 100)}%` }} />
                      </div>
                    )}
                    {ex.stage && <p className="data-label mt-2">{ex.stage}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
