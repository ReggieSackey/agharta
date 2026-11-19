'use client';

import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { useEffect } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { Tile, EvidenceChip, EmptyState } from '@/components/bits';
import Link from 'next/link';

export default function DashboardPage() {
  // ensure identity + default workspace exist (idempotent)
  const me = useMutation(api.users.getOrCreateMe);
  useEffect(() => {
    void me({});
  }, [me]);

  const identity = useQuery(api.users.me);
  const workspaceId = identity?.workspaceId ?? null;
  const problems = useQuery(
    api.problems.listByWorkspace,
    workspaceId ? { workspaceId } : 'skip'
  );
  const explorations = useQuery(
    api.explorations.listByWorkspace,
    workspaceId ? { workspaceId } : 'skip'
  );
  const learning = useQuery(api.learning.summary, workspaceId ? { workspaceId } : 'skip');

  if (!workspaceId) {
    return (
      <DashboardShell>
        <p className="data-label">loading workspace…</p>
      </DashboardShell>
    );
  }

  const completed = explorations?.filter((e) => e.status === 'completed') ?? [];
  const ideasCount = explorations?.reduce((s, e) => s + (e.summary ? (e.summary.recommendations?.length ?? 0) : 0), 0) ?? 0;
  const succeeded = learning?.operators.reduce((s, o) => s + o.counters.succeeded, 0) ?? 0;
  const attempted = learning?.operators.reduce((s, o) => s + o.counters.attempted, 0) ?? 0;

  return (
    <DashboardShell>
      <h1 className="mb-6 text-xl font-semibold">Dashboard</h1>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="explorations" value={explorations?.length ?? 0} />
        <Tile label="completed" value={completed.length} sub="finished runs" />
        <Tile
          label="recommended ideas"
          value={ideasCount}
          sub="automated proxy only"
        />
        <Tile label="tested (attempted)" value={attempted} sub="user-reported" />
        <Tile
          label="validated successes"
          value={succeeded}
          sub="self-reported outcomes"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Recent problems</h2>
            <Link href="/problems/new" className="text-sm text-[var(--color-blue)] hover:underline">
              new problem →
            </Link>
          </div>
          {problems === undefined ? (
            <p className="data-label">loading…</p>
          ) : problems.length === 0 ? (
            <EmptyState
              title="No problems yet"
              body="Describe a difficult, open-ended problem and Agharta will search for meaningfully different approaches through its four creative operators."
              action={
                <Link href="/problems/new" className="rounded bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-paper)]">
                  Create your first problem
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {problems.slice(0, 5).map((p) => (
                <li key={p._id}>
                  <Link href={`/problems/${p._id}`} className="panel block px-4 py-3 hover:border-[var(--color-blue)]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{p.title}</span>
                      <span className="data-label shrink-0">{p.domain}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-[var(--color-muted)]">{p.desiredOutcome}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-medium">Operator ranking</h2>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left">
                  <th className="px-4 py-2 font-normal"><span className="data-label">operator</span></th>
                  <th className="px-2 py-2 font-normal"><span className="data-label">unique</span></th>
                  <th className="px-2 py-2 font-normal"><span className="data-label">proxy est. ±</span></th>
                  <th className="px-2 py-2 font-normal"><span className="data-label">outcomes</span></th>
                </tr>
              </thead>
              <tbody>
                {(learning?.operators ?? [])
                  .filter((o) => o.domain === 'all')
                  .sort((a, b) => b.counters.unique - a.counters.unique)
                  .map((o) => (
                    <tr key={`${o.domain}-${o.operatorId}`} className="border-b border-[var(--color-line)] last:border-0">
                      <td className="px-4 py-2 capitalize">{o.operatorId}</td>
                      <td className="px-2 py-2 tabular-nums">{o.counters.unique}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {o.proxyEstimate.mean.toFixed(2)} ±{o.proxyEstimate.uncertainty.toFixed(2)}
                        <span className="data-label ml-1">{o.proxyEstimate.insufficientData ? 'sparse' : ''}</span>
                      </td>
                      <td className="px-2 py-2">
                        {o.counters.succeeded + o.counters.failed > 0 ? (
                          <span className="tabular-nums">{o.counters.succeeded}✓ / {o.counters.failed}✗</span>
                        ) : (
                          <EvidenceChip kind="unknown" />
                        )}
                      </td>
                    </tr>
                  ))}
                {learning && learning.operators.filter((o) => o.domain === 'all').length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-[var(--color-muted)]">
                      No operator data yet — run an exploration, then mark outcomes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Proxy estimates are smoothed (Beta-Bernoulli) automated-rubric rates, separate from
            real outcome counts. Unknown outcomes never count as failures.
          </p>
        </section>
      </div>
    </DashboardShell>
  );
}
