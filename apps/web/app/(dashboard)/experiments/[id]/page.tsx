'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';
import { EmptyState } from '@/components/bits';

export default function ExperimentDetail({ params }: { params: { id: string } }) {
  const experiment = useQuery(api.experiments.get, { experimentId: params.id as never });

  if (experiment === undefined) {
    return <DashboardShell><p className="data-label">loading…</p></DashboardShell>;
  }
  if (experiment === null) {
    return <DashboardShell><EmptyState title="Not found" body="This experiment does not exist in your workspace." /></DashboardShell>;
  }
  const rec = experiment.record;
  if (!rec) {
    return (
      <DashboardShell>
        <EmptyState title={`Experiment ${experiment.status}`} body="Still starting up — refresh in a moment." />
      </DashboardShell>
    );
  }
  if (rec.status === 'failed') {
    return (
      <DashboardShell>
        <h1 className="text-xl font-semibold mb-2">Experiment failed</h1>
        <pre className="text-xs bg-red-50 border border-red-200 rounded p-3 whitespace-pre-wrap">{rec.errors?.join('\n')}</pre>
      </DashboardShell>
    );
  }
  const running = rec.status !== 'completed';

  return (
    <DashboardShell>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-xl font-semibold">Experiment</h1>
        <span className="text-xs text-neutral-500">
          map {rec.mapVersionId?.split(':')[0]} · policy {rec.policyVersionId?.split(':')[0]}
        </span>
      </div>

      <Section title="Problem (as interpreted)">
        <p className="text-sm">{rec.problemStructure.objective}</p>
        <div className="flex flex-wrap gap-1 mt-2">
          {rec.problemStructure.structureTags.map((t: string) => (
            <span key={t} className="text-[11px] bg-neutral-100 rounded-full px-2 py-0.5">{t}</span>
          ))}
        </div>
        {rec.problemStructure.conventionalSolutions?.length > 0 && (
          <p className="text-xs text-neutral-500 mt-2">
            Moving beyond: {rec.problemStructure.conventionalSolutions.join(' · ')}
          </p>
        )}
      </Section>

      {running && <Section title={`Status: ${rec.status}`}><p className="text-sm text-neutral-500">Refresh to see progress.</p></Section>}

      {rec.hypotheses?.length > 0 && (
        <Section title={`Hypotheses investigated (${rec.hypotheses.length})`}>
          <div className="space-y-2">
            {rec.hypotheses.map((h: any) => (
              <div key={h.id} className="border rounded p-3">
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    {h.mechanismName} <span className="text-neutral-400">({h.mechanismField})</span>
                  </p>
                  <div className="flex gap-1">
                    <SlotBadge slot={h.slot} />
                    <StatusBadge status={h.status} />
                  </div>
                </div>
                <p className="text-xs text-neutral-600 mt-1">{h.transferRationale}</p>
                {h.rejectionReason && <p className="text-xs text-red-600 mt-1">Rejected: {h.rejectionReason}</p>}
                <p className="text-[11px] text-neutral-400 mt-1">
                  policy score {h.policyScore?.toFixed(2)} · selection p={h.selectionProbability?.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {rec.finalProposals?.length > 0 && (
        <Section title={`Final proposals (${rec.finalProposals.length})`}>
          <div className="space-y-4">
            {rec.finalProposals.map((f: any) => {
              const cand = rec.candidates?.find((c: any) => c.id === f.candidateId);
              return (
                <div key={f.candidateId} className="border-2 rounded-lg p-4">
                  <div className="flex justify-between items-baseline">
                    <h3 className="font-semibold">{f.title}</h3>
                    <span className="text-xs bg-neutral-900 text-white px-2 py-0.5 rounded-full">novelty {f.novelty?.toFixed(2)}</span>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{f.proposal}</p>
                  {cand && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2 text-xs">
                      <div>
                        <p className="data-label">Mechanism transfer</p>
                        <p className="text-neutral-600">{cand.transferStory}</p>
                      </div>
                      <div>
                        <p className="data-label">Why it differs</p>
                        <p className="text-neutral-600">{cand.differenceFromConventional}</p>
                      </div>
                      <div>
                        <p className="data-label">How to explore</p>
                        <p className="text-neutral-600">{cand.explorationStep}</p>
                      </div>
                      <div>
                        <p className="data-label">Assumptions</p>
                        <ul className="list-disc ml-4 text-neutral-600">
                          {cand.assumptions?.map((a: string, i: number) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {rec.noveltyAssessments?.length > 0 && (
        <Section title="Rejected and intermediate candidates">
          <div className="space-y-1">
            {rec.candidates?.filter((c: any) => c.stage === 'discarded').map((c: any) => (
              <p key={c.id} className="text-xs text-neutral-500">
                <span className="line-through">{c.title}</span> — {c.discardReason ?? 'discarded'}
              </p>
            ))}
            {rec.candidates?.filter((c: any) => c.stage === 'discarded').length === 0 && (
              <p className="text-xs text-neutral-400">No discarded candidates this run.</p>
            )}
          </div>
        </Section>
      )}

      <Section title="Run accounting">
        <p className="text-xs text-neutral-500 font-mono">
          {rec.usage?.modelCalls ?? 0} model calls · {rec.usage?.inputTokens ?? 0} in / {rec.usage?.outputTokens ?? 0} out tokens ·
          provider {rec.modelInfo?.provider ?? '?'} · {rec.errors?.length ?? 0} errors
        </p>
      </Section>
    </DashboardShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-2">{title}</h2>
      {children}
    </section>
  );
}
function SlotBadge({ slot }: { slot: string }) {
  const label = slot === 'exploitation' ? 'guided' : slot === 'exploration' ? 'exploring' : 'wildcard';
  const color = slot === 'exploitation' ? 'bg-blue-100 text-blue-800' : slot === 'exploration' ? 'bg-purple-100 text-purple-800' : 'bg-orange-100 text-orange-800';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${color}`}>{label}</span>;
}
function StatusBadge({ status }: { status: string }) {
  const color = status === 'investigated' ? 'bg-green-100 text-green-800' : status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-neutral-100 text-neutral-700';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${color}`}>{status}</span>;
}
