/**
 * Extract Engine 2 observations from completed Engine 1 experiment records.
 * Pure function; Convex learning actions call it per-experiment.
 *
 * An observation captures per-hypothesis outcomes: did investigating this
 * mechanism produce at least one novel + coherent candidate? Duplicate and
 * incoherent outcome counts feed failure learning. Human-tier counts are
 * joined later from feedback tables (kept separate).
 */
import type { ExperimentRecord, ExperimentObservation, HypothesisOutcome } from '@agharta/shared';
import { noveltyComposite } from '@agharta/shared';

export function extractObservation(record: ExperimentRecord): ExperimentObservation | null {
  if (record.status !== 'completed' || !record.problemStructure) return null;

  const assessmentByCandidate = new Map(record.noveltyAssessments.map((a) => [a.candidateId, a]));
  const candidatesByHypothesis = new Map<string, typeof record.candidates>();
  for (const c of record.candidates) {
    const list = candidatesByHypothesis.get(c.hypothesisId) ?? [];
    list.push(c);
    candidatesByHypothesis.set(c.hypothesisId, list);
  }

  const hypothesisOutcomes: HypothesisOutcome[] = record.hypotheses.map((h) => {
    const cands = candidatesByHypothesis.get(h.id) ?? [];
    const scored = cands
      .map((c) => ({ c, a: assessmentByCandidate.get(c.id) }))
      .filter((x) => x.a !== undefined);

    // novel + coherent: composite novelty >= 3.0 AND coherence/relevance gates passed
    const novelCoherent = scored.filter(
      ({ a }) => noveltyComposite(a) >= 3.0 && a.coherence >= 0.4 && a.relevance >= 0.4
    );
    const duplicates = scored.filter(({ c }) =>
      record.noveltyAssessments.some((a) => a.candidateId !== c.id && a.justification.includes(c.title))
    ).length;
    const incoherent = scored.filter(({ a }) => a.coherence < 0.4 || a.relevance < 0.4).length;
    const bestNovelty = scored.length
      ? Math.max(...scored.map(({ a }) => noveltyComposite(a)))
      : 0;

    return {
      hypothesisId: h.id,
      experimentId: record.id,
      mechanismId: h.mechanismId,
      mechanismField: h.mechanismField,
      structureTags: record.problemStructure.structureTags,
      slot: h.slot,
      producedNovelCoherent: novelCoherent.length > 0,
      bestNovelty,
      duplicateOutcomes: duplicates,
      incoherentOutcomes: incoherent,
      candidateCount: cands.length,
      humanShortlisted: 0, // joined from feedback by the learning action
      humanRejected: 0,
      policyScore: h.policyScore,
      selectionProbability: h.selectionProbability,
    };
  });

  return {
    experimentId: record.id,
    workspaceId: record.workspaceId,
    problemStructure: record.problemStructure,
    domain: record.domain,
    hypothesisOutcomes,
    feedbackActions: [],
    observedAt: record.finishedAt ?? record.startedAt,
  };
}
