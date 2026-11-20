'use client';

import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EmptyState } from '@/components/bits';

export default function V2LearningPage() {
  const active = useQuery(api.experiments.activeArtifacts, {});
  const history = useQuery(api.experiments.learningHistory, {});
  const rollback = useMutation(api.experiments.rollbackTo);

  const map = active?.map;
  const policy = active?.policy;
  const runs = history?.runs ?? [];
  const promotions = history?.promotions ?? [];
  const edges = (map?.artifact?.edges ?? []) as Array<{ from: string; to: string; compatibility: number; alpha: number; beta: number; automatedEvidenceCount: number }>;

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold mb-1">Learning (Engine 2)</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-2xl">
        Engine 2 learns asynchronously from completed experiments. Candidates are evaluated
        against the champion on held-out validation problems; only gate-passing updates are
        promoted automatically. Nothing here is simulated — every row is a real learning run.
      </p>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <div className="border rounded p-4">
          <p className="data-label">Active map</p>
          <p className="text-lg font-semibold">{map?.version ?? '—'}</p>
          <p className="text-xs text-neutral-500 mt-1">{map?.artifact?.nodes?.length ?? 0} nodes · {edges.length} learned edges</p>
        </div>
        <div className="border rounded p-4">
          <p className="data-label">Active policy</p>
          <p className="text-lg font-semibold">{policy?.version ?? '—'}</p>
          <p className="text-xs text-neutral-500 mt-1">
            {Object.keys(policy?.artifact?.compatWeights ?? {}).length} learned feature weights ·
            exploration floor {policy?.artifact?.explorationFloor ?? '—'}
          </p>
        </div>
        <div className="border rounded p-4">
          <p className="data-label">Promotion decisions</p>
          <p className="text-lg font-semibold">{runs.filter((r) => r.status === 'promoted').length} promoted · {runs.filter((r) => r.status === 'retained').length} retained</p>
          <p className="text-xs text-neutral-500 mt-1">{promotions.length} audit entries</p>
        </div>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">Top learned edges (structure → mechanism)</h2>
      {edges.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-8">No learned edges yet — the map is at its uniform prior. Run experiments to give Engine 2 evidence.</p>
      ) : (
        <div className="border rounded divide-y mb-8">
          {edges.sort((a, b) => b.compatibility - a.compatibility).slice(0, 12).map((e) => (
            <div key={`${e.from}→${e.to}`} className="p-3 flex justify-between items-center text-sm">
              <span className="font-mono text-xs">{e.from.replace('tag:', '')} → {e.to}</span>
              <span className="flex gap-4 items-center">
                <span className="text-xs text-neutral-500">α{e.alpha.toFixed(1)} β{e.beta.toFixed(1)} · {e.automatedEvidenceCount} obs</span>
                <span className="font-semibold">{e.compatibility.toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">Learning runs</h2>
      {runs.length === 0 ? (
        <EmptyState title="No learning runs yet" body="Learning triggers automatically after each completed experiment." />
      ) : (
        <div className="space-y-3 mb-8">
          {runs.map((r) => {
            const ev = r.evaluation;
            return (
              <div key={r._id} className="border rounded p-4">
                <div className="flex justify-between items-baseline flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <RunBadge status={r.status} />
                    <span className="text-xs text-neutral-500">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  {r.candidatePolicyVersionId && (
                    <span className="text-[11px] text-neutral-400 font-mono">candidate {r.candidatePolicyVersionId.split(':')[0]}</span>
                  )}
                </div>
                {ev ? (
                  <div className="mt-2 text-xs text-neutral-600 space-y-1">
                    <p>
                      champion novelty <b>{ev.championMetrics?.meanNovelty?.toFixed(3)}</b> vs challenger <b>{ev.challengerMetrics?.meanNovelty?.toFixed(3)}</b> ·
                      P(challenger better) = <b>{ev.challengerBetterProb?.toFixed(3)}</b>
                    </p>
                    <p className="text-neutral-500">{(ev.reasons ?? []).join(' · ')}</p>
                  </div>
                ) : r.error ? (
                  <p className="mt-2 text-xs text-red-600">error: {r.error}</p>
                ) : (
                  <p className="mt-2 text-xs text-neutral-400">running…</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">Promotion audit & rollback</h2>
      <p className="text-xs text-neutral-400 mb-2">Rollback restores the exact map+policy pair recorded at promotion time.</p>
      {promotions.length === 0 ? (
        <p className="text-xs text-neutral-400">No promotions yet (champion retained on every gate so far).</p>
      ) : (
        <div className="border rounded divide-y">
          {promotions.map((p) => {
            const [mapV, policyV] = (p.toVersion ?? '').split('|');
            return (
              <div key={p._id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.decision === 'auto_promote' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{p.decision}</span>
                  <span className="ml-2 text-xs text-neutral-500">{new Date(p.at).toLocaleString()}</span>
                  <p className="text-[11px] text-neutral-400 font-mono mt-1">{mapV?.split(':')[0]} + {policyV?.split(':')[0]}</p>
                  {p.rationale && <p className="text-[11px] text-neutral-400 mt-0.5 max-w-xl">{p.rationale.slice(0, 160)}</p>}
                </div>
                <button
                  className="text-xs underline text-neutral-500"
                  onClick={async () => {
                    if (!mapV || !policyV) return;
                    await rollback({ mapVersionId: mapV, policyVersionId: policyV, reason: `rollback to ${policyV}` });
                  }}
                >
                  rollback here
                </button>
              </div>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}

function RunBadge({ status }: { status: string }) {
  const color =
    status === 'promoted' ? 'bg-green-100 text-green-800'
    : status === 'retained' ? 'bg-neutral-100 text-neutral-700'
    : status === 'failed' ? 'bg-red-100 text-red-800'
    : 'bg-amber-100 text-amber-800';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${color}`}>{status}</span>;
}
