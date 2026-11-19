'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EvidenceChip } from '@/components/bits';

const TABS = ['search policy', 'experiments', 'history', 'feedback coverage'] as const;

export default function LearningPage() {
  const identity = useQuery(api.users.me);
  const workspaceId = identity?.workspaceId ?? null;
  const [tab, setTab] = useState<(typeof TABS)[number]>('search policy');

  const summary = useQuery(api.learning.summary, workspaceId ? { workspaceId } : 'skip');
  const coverage = useQuery(api.learning.feedbackCoverage, workspaceId ? { workspaceId } : 'skip');
  const experiments = useQuery(api.strategies.listExperiments, workspaceId ? { workspaceId } : 'skip');
  const strategies = useQuery(api.strategies.listByWorkspace, workspaceId ? { workspaceId } : 'skip');
  const challenge = useMutation(api.strategies.challenge);
  const promote = useMutation(api.strategies.promote);
  const [challenging, setChallenging] = useState(false);

  const champion = strategies?.find((s) => s.state === 'champion');

  return (
    <DashboardShell>
      <h1 className="mb-2 text-xl font-semibold">Learning</h1>
      <p className="mb-5 max-w-2xl text-sm text-[var(--color-muted)]">
        How the engine adapts. Only benchmark-backed or real-outcome-backed changes are labeled
        &ldquo;demonstrated&rdquo;; proxy estimates are automated and provisional.
      </p>

      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded border px-3 py-1.5 text-xs capitalize ${
              tab === t ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]' : 'border-[var(--color-line)] text-[var(--color-muted)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'search policy' && (
        <section className="space-y-4">
          <div className="panel p-5">
            <p className="data-label mb-2">current allocation</p>
            {summary?.recentDecisions?.[0] ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4">
                  {Object.entries(summary.recentDecisions[0].weights as Record<string, number>).map(([op, w]) => (
                    <div key={op}>
                      <p className="data-label">{op}</p>
                      <p className="tabular-nums text-lg font-semibold">{(w * 100).toFixed(1)}%</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--color-muted)]">{summary.recentDecisions[0].reason}</p>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">
                Equal allocation with a 10% exploration floor (default until evidence accumulates).
              </p>
            )}
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left">
                  {['operator', 'generated', 'unique', 'qualified (auto)', 'proxy est ±', 'succeeded', 'failed', 'evidence'].map((h) => (
                    <th key={h} className="px-4 py-2 font-normal"><span className="data-label">{h}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(summary?.operators ?? []).filter((o) => o.domain === 'all').map((o) => (
                  <tr key={o.operatorId} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-4 py-2 capitalize">{o.operatorId}</td>
                    <td className="px-4 py-2 tabular-nums">{o.counters.generated}</td>
                    <td className="px-4 py-2 tabular-nums">{o.counters.unique}</td>
                    <td className="px-4 py-2 tabular-nums">{o.counters.provisionallyQualified} <span className="data-label">auto</span></td>
                    <td className="px-4 py-2 tabular-nums">
                      {o.proxyEstimate.mean.toFixed(2)} ±{o.proxyEstimate.uncertainty.toFixed(2)}
                      {o.proxyEstimate.insufficientData && <span className="data-label ml-1">sparse</span>}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{o.counters.succeeded}</td>
                    <td className="px-4 py-2 tabular-nums">{o.counters.failed}</td>
                    <td className="px-4 py-2">
                      {o.counters.succeeded + o.counters.failed > 0 ? <EvidenceChip kind="external_test" /> : <EvidenceChip kind="automated_proxy" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            Underexplored operators always retain ≥10% allocation (exploration floor). Operators
            are never permanently removed — they go dormant and can be re-explored.
          </p>
        </section>
      )}

      {tab === 'experiments' && (
        <section className="space-y-4">
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="data-label mb-1">champion</p>
              <p className="font-medium">{champion ? champion.version : 'v0.1 (bootstrap)'}</p>
            </div>
            {champion && (
              <button
                onClick={async () => {
                  setChallenging(true);
                  try {
                    await challenge({
                      baseStrategyId: champion._id,
                      changeProposal: 'optimizer-proposed single change',
                    });
                  } finally {
                    setChallenging(false);
                  }
                }}
                disabled={challenging}
                className="rounded bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-paper)] disabled:opacity-50"
              >
                {challenging ? 'running challenger…' : 'Launch strategy challenge'}
              </button>
            )}
          </div>
          {(experiments?.experiments ?? []).length === 0 ? (
            <p className="panel px-4 py-10 text-center text-sm text-[var(--color-muted)]">
              No experiments yet. A challenge runs champion vs challenger on the same fixed
              benchmark problems with matched budgets and multiple seeds.
            </p>
          ) : (
            <ul className="space-y-3">
              {(experiments?.experiments ?? []).map((exp) => (
                <li key={exp._id} className="panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="data-label">experiment · {exp.benchmarkVersion}</span>
                    <EvidenceChip kind={exp.decision === 'eligible_for_promotion' ? 'external_test' : exp.decision === 'rejected' ? 'failed' : 'unknown'} />
                  </div>
                  <p className="mt-1 text-sm">{exp.rationale}</p>
                  {exp.championResult && exp.challengerResult && (
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      {(['championResult', 'challengerResult'] as const).map((k) => {
                        const arm = exp[k] as { strategyVersion: string; metrics: Record<string, number> };
                        return (
                          <div key={k} className="rounded border border-[var(--color-line)] p-3">
                            <p className="data-label mb-1">{arm.strategyVersion}</p>
                            <p>qualified unique: <span className="tabular-nums">{arm.metrics.qualifiedUniqueIdeas}</span></p>
                            <p>top-K diversity: <span className="tabular-nums">{arm.metrics.topKDiversity?.toFixed(3)}</span></p>
                            <p>cost: <span className="tabular-nums">${arm.metrics.costUsd?.toFixed(4)}</span></p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {exp.decision === 'eligible_for_promotion' && (
                    <button
                      onClick={() => void promote({ experimentId: exp._id })}
                      className="mt-3 rounded bg-[var(--color-moss)] px-4 py-2 text-sm text-white"
                    >
                      Approve promotion (owner)
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section className="space-y-3">
          {(experiments?.audit ?? []).length === 0 ? (
            <p className="panel px-4 py-10 text-center text-sm text-[var(--color-muted)]">No promotions yet.</p>
          ) : (
            (experiments?.audit ?? []).map((a) => (
              <div key={a._id} className="panel p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.fromVersion} → {a.toVersion}</span>
                  <span className="data-label">{new Date(a.at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{a.rationale}</p>
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'feedback coverage' && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {coverage && (
            <>
              {(['shortlisted', 'attempted', 'succeeded', 'failed', 'unknown'] as const).map((k) => (
                <div key={k} className="panel p-4">
                  <p className="data-label">{k}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{coverage[k]}</p>
                </div>
              ))}
            </>
          )}
          <p className="col-span-full text-xs text-[var(--color-muted)]">
            Unknown outcomes (recommended but not yet decided) are never counted as failures.
          </p>
        </section>
      )}
    </DashboardShell>
  );
}
