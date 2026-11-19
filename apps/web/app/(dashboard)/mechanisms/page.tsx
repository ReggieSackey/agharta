'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EvidenceChip } from '@/components/bits';

export default function MechanismsPage() {
  const identity = useQuery(api.users.me);
  const workspaceId = identity?.workspaceId ?? null;
  const mechanisms = useQuery(api.mechanisms.listByWorkspace, workspaceId ? { workspaceId } : 'skip');
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useQuery(api.mechanisms.detail, openId ? { mechanismId: openId as never } : 'skip');

  return (
    <DashboardShell>
      <h1 className="mb-2 text-xl font-semibold">Mechanisms</h1>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Conceptual causal approaches and operator families, with attempts, evaluable counts, and
        outcome shares. Sample sizes are always shown — a mechanism with 2 successes is not
        &ldquo;better&rdquo; than one with 30/60.
      </p>

      {mechanisms === undefined ? (
        <p className="data-label">loading…</p>
      ) : mechanisms.length === 0 ? (
        <p className="panel px-4 py-10 text-center text-sm text-[var(--color-muted)]">
          Mechanisms appear after your first exploration completes.
        </p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left">
                {['mechanism', 'ideas', 'promising (auto)', 'observed', 'uncertainty', 'status', ''].map((h) => (
                  <th key={h} className="px-4 py-2 font-normal"><span className="data-label">{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mechanisms.map((m) => {
                const attempted = (m.outcomeBreakdown['attempted'] ?? 0) + (m.outcomeBreakdown['succeeded'] ?? 0) + (m.outcomeBreakdown['failed'] ?? 0);
                const succeeded = m.outcomeBreakdown['succeeded'] ?? 0;
                return (
                  <tr key={m.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-medium">{m.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">{m.normalizedDescription}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{m.ideaCount}</td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums">{m.outcomeBreakdown['selected'] ?? 0}</span>
                      <span className="data-label ml-1">auto</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {attempted > 0 ? `${succeeded}/${attempted}` : <EvidenceChip kind="unknown" />}
                    </td>
                    <td className="px-4 py-3">
                      <span className="data-label">{m.ideaCount < 5 ? 'sparse n=' + m.ideaCount : 'n=' + m.ideaCount}</span>
                    </td>
                    <td className="px-4 py-3"><span className="data-label">{m.status ?? 'active'}</span></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setOpenId(m.id)} className="text-xs text-[var(--color-blue)] hover:underline">
                        drill in
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <aside className="h-full w-full max-w-md overflow-y-auto border-l border-[var(--color-line)] bg-white p-6" role="dialog" aria-label="mechanism detail">
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="font-medium">{detail.mechanism.name}</h2>
              <button onClick={() => setOpenId(null)} className="data-label">close</button>
            </div>
            <p className="mb-4 text-sm text-[var(--color-muted)]">{detail.mechanism.normalizedDescription}</p>
            <p className="data-label mb-2">contributed ideas</p>
            <ul className="space-y-2">
              {detail.ideas.map((i) => (
                <li key={i.id} className="panel p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{i.title}</span>
                    <EvidenceChip kind={i.selectionState ?? 'unknown'} />
                  </div>
                  {i.selectionState === 'failed' && (
                    <p className="mt-1 text-[var(--color-muted)]">failure recorded — see idea feedback for reason</p>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </DashboardShell>
  );
}
