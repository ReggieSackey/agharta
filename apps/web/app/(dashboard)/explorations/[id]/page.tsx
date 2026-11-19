'use client';

import { use, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EvidenceChip, UncertaintyBar, OPERATOR_LABELS } from '@/components/bits';
import { LineageView } from '@/components/LineageView';

type SortKey = 'proxy' | 'originality' | 'usefulness' | 'feasibility' | 'novelty';

export default function ExplorationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const data = useQuery(api.explorations.get, { explorationId: id as never });
  const lineage = useQuery(api.ideas.getWithLineage, data && selectedId ? { ideaId: selectedId as never } : 'skip');
  const submitFeedback = useMutation(api.feedback.submit);
  const cancelExploration = useMutation(api.explorations.cancel);

  const [sortKey, setSortKey] = useState<SortKey>('proxy');
  const [operatorFilter, setOperatorFilter] = useState<string>('all');
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedbackAction, setFeedbackAction] = useState('shortlisted');
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackEvidence, setFeedbackEvidence] = useState('');
  const [feedbackState, setFeedbackState] = useState<'idle' | 'saving' | 'done'>('idle');

  const ideas = data?.ideas ?? [];

  const sorted = useMemo(() => {
    const rows = [...ideas];
    rows.sort((a, b) => {
      const ea = a.evaluation;
      const eb = b.evaluation;
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      switch (sortKey) {
        case 'proxy':
          return (eb.originality + eb.usefulness + eb.feasibility) - (ea.originality + ea.usefulness + ea.feasibility);
        case 'novelty':
        case 'originality':
          return eb.originality - ea.originality;
        case 'usefulness':
          return eb.usefulness - ea.usefulness;
        case 'feasibility':
          return eb.feasibility - ea.feasibility;
      }
    });
    return operatorFilter === 'all' ? rows : rows.filter((r) => r.operatorId === operatorFilter);
  }, [ideas, sortKey, operatorFilter]);

  if (!data) {
    return (
      <DashboardShell>
        <p className="data-label">loading…</p>
      </DashboardShell>
    );
  }

  const ex = data.exploration;
  const running = ex.status === 'queued' || ex.status === 'running';

  return (
    <DashboardShell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="data-label mb-1">exploration · {ex.budget?.preset ?? ''}</p>
          <h1 className="text-xl font-semibold">
            {running ? 'Searching…' : ex.status === 'completed' ? 'Results' : ex.status}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <button
              onClick={() => void cancelExploration({ explorationId: ex._id })}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:border-[var(--color-terra)] hover:text-[var(--color-terra)]"
            >
              cancel
            </button>
          )}
          <EvidenceChip kind={ex.status} />
        </div>
      </div>

      {running && (
        <div className="panel mb-6 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="data-label">{ex.stage ?? 'queued'}</span>
            <span className="data-label">{Math.round((ex.progress ?? 0.02) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded bg-[var(--color-line)]" role="progressbar">
            <div className="h-1.5 rounded bg-[var(--color-blue)] transition-all" style={{ width: `${Math.round((ex.progress ?? 0) * 100)}%` }} />
          </div>
          {ex.usage && (
            <p className="data-label mt-2">
              {ex.usage.modelCalls ?? 0} model calls · ${((ex.usage.costUsd ?? 0) as number).toFixed(4)}
            </p>
          )}
        </div>
      )}

      {ex.status === 'completed' && ex.summary?.recommendations && (
        <section className="panel panel-accent mb-6 p-5">
          <p className="data-label mb-2">recommendations — heuristic selection</p>
          <ol className="space-y-2">
            {ex.summary.recommendations.map((r: { ideaId: string; title: string; tradeoffs: string }, i: number) => (
              <li key={r.ideaId} className="flex gap-3 text-sm">
                <span className="data-label pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <button onClick={() => setSelectedId(r.ideaId)} className="font-medium hover:underline">
                    {r.title}
                  </button>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{r.tradeoffs}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="data-label">sort</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
        >
          <option value="proxy">proxy aggregate</option>
          <option value="originality">originality</option>
          <option value="usefulness">usefulness</option>
          <option value="feasibility">feasibility</option>
          <option value="novelty">novelty (auto)</option>
        </select>
        <span className="data-label">operator</span>
        <select
          value={operatorFilter}
          onChange={(e) => setOperatorFilter(e.target.value)}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
        >
          <option value="all">all</option>
          <option value="divergent">divergent</option>
          <option value="analogy">analogy</option>
          <option value="inversion">inversion</option>
          <option value="recombination">recombination</option>
        </select>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(380px,42%)]">
        <section aria-label="candidate ideas" className="space-y-3">
          {sorted.length === 0 && !running && (
            <p className="panel px-4 py-8 text-center text-sm text-[var(--color-muted)]">No ideas yet.</p>
          )}
          {sorted.map((idea) => {
            const e = idea.evaluation;
            return (
              <article key={idea.id} className={`panel p-4 ${selectedId === idea.id ? 'panel-accent' : ''}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="data-label">{OPERATOR_LABELS[idea.operatorId] ?? idea.operatorId}</span>
                  <span className="data-label">gen {idea.generation}</span>
                  {idea.parentIds.length > 0 && (
                    <span className="data-label">↳ {idea.parentIds.length} parent{idea.parentIds.length > 1 ? 's' : ''}</span>
                  )}
                  {idea.sourceConceptIds.length > 0 && <span className="data-label">source: {idea.sourceConceptIds.join(', ')}</span>}
                  <span className="ml-auto"><EvidenceChip kind={idea.selectionState ?? 'unknown'} /></span>
                </div>
                <h3 className="font-medium">{idea.title}</h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{idea.intervention}</p>
                <details className="mt-2">
                  <summary className="data-label cursor-pointer">why it might work · assumptions · failure modes · test</summary>
                  <div className="mt-2 space-y-2 text-xs text-[var(--color-muted)]">
                    <p><span className="data-label">mechanism — </span>{idea.causalMechanism}</p>
                    <p><span className="data-label">assumptions — </span>{idea.assumptions.join('; ')}</p>
                    <p><span className="data-label">failure modes — </span>{idea.failureModes.join('; ')}</p>
                    <p><span className="data-label">test — </span>{idea.proposedTest}</p>
                    {idea.invertedConstraint && (
                      <p><span className="data-label">inverted — </span>{idea.invertedConstraint}
                        {typeof idea.survivedRepair === 'boolean' && (idea.survivedRepair ? ' (survived repair)' : ' (lost in repair)')}
                      </p>
                    )}
                  </div>
                </details>
                {e && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-3">
                    <span className="text-xs tabular-nums">orig {e.originality} · use {e.usefulness} · feas {e.feasibility}</span>
                    <UncertaintyBar value={e.uncertainty} />
                    <EvidenceChip kind="automated_proxy" />
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setSelectedId(idea.id)} className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs hover:border-[var(--color-blue)]">
                    lineage
                  </button>
                  <button
                    onClick={() => { setFeedbackFor(idea.id); setFeedbackState('idle'); }}
                    className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs hover:border-[var(--color-blue)]"
                  >
                    outcome…
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <aside aria-label="lineage" className="space-y-3">
          <p className="data-label">lineage — click a node to inspect</p>
          <LineageView
            ideas={ideas.map((i) => ({
              id: i.id,
              title: i.title,
              operatorId: i.operatorId,
              generation: i.generation,
              parentIds: i.parentIds,
              selectionState: i.selectionState,
            }))}
            onSelect={(nid) => setSelectedId(nid)}
            selectedId={selectedId ?? undefined}
          />
          {lineage && (
            <div className="panel p-4 text-xs">
              <p className="data-label mb-1">inspector</p>
              <p className="font-medium">{lineage.idea.title}</p>
              <p className="mt-1 text-[var(--color-muted)]">{lineage.idea.causalMechanism}</p>
              {lineage.ancestors.length > 0 && (
                <>
                  <p className="data-label mb-1 mt-3">ancestry</p>
                  <ul className="space-y-1">
                    {lineage.ancestors.map((a) => (
                      <li key={String(a.id)} className="text-[var(--color-muted)]">
                        gen {(a as { generation: number }).generation}: {(a as { title: string }).title}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {lineage.sources.length > 0 && (
                <>
                  <p className="data-label mb-1 mt-3">analogy sources</p>
                  <ul className="space-y-1">
                    {lineage.sources.map((s, i) => (
                      <li key={i} className="text-[var(--color-muted)]">{s.sourceConceptSlug}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {feedbackFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="record outcome"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => e.target === e.currentTarget && setFeedbackFor(null)}
        >
          <div className="panel w-full max-w-md bg-white p-5">
            <h2 className="mb-1 font-medium">Record an outcome</h2>
            <p className="mb-4 text-xs text-[var(--color-muted)]">
              Self-reported outcomes are stored as <code>self_reported</code> evidence — separate
              from automated scores, never counted as failures when unknown.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {['shortlisted', 'rejected', 'attempted', 'succeeded', 'failed'].map((a) => (
                <button
                  key={a}
                  onClick={() => setFeedbackAction(a)}
                  aria-pressed={feedbackAction === a}
                  className={`rounded border px-3 py-1.5 text-xs capitalize ${
                    feedbackAction === a ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]' : 'border-[var(--color-line)]'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <textarea
              value={feedbackReason}
              onChange={(e) => setFeedbackReason(e.target.value)}
              rows={2}
              placeholder="reason (optional)"
              className="mb-2 w-full rounded border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            <textarea
              value={feedbackEvidence}
              onChange={(e) => setFeedbackEvidence(e.target.value)}
              rows={2}
              placeholder="evidence / observed metric (optional)"
              className="mb-3 w-full rounded border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            {feedbackState === 'done' && <p className="mb-2 text-xs text-[var(--color-moss)]">Recorded. Stats will update shortly.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setFeedbackFor(null)} className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm">
                close
              </button>
              <button
                disabled={feedbackState === 'saving'}
                onClick={async () => {
                  setFeedbackState('saving');
                  try {
                    await submitFeedback({
                      ideaId: feedbackFor as never,
                      action: feedbackAction,
                      reason: feedbackReason || undefined,
                      evidence: feedbackEvidence || undefined,
                    });
                    setFeedbackState('done');
                  } catch {
                    setFeedbackState('idle');
                  }
                }}
                className="rounded bg-[var(--color-ink)] px-4 py-1.5 text-sm text-[var(--color-paper)] disabled:opacity-50"
              >
                {feedbackState === 'saving' ? 'saving…' : 'submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
