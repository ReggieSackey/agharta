/**
 * V2 Engine 1 — experimental creative search pipeline.
 *
 * interpret → consult → hypothesize → investigate → evaluate → refine → record
 *
 * Every model call goes through ModelAdapter (fake or real). Selection uses
 * the LEARNED policy (from @agharta/learning selection) — that's the behavior
 * lever Engine 2 moves. Artifacts are snapshotted at start; mid-run
 * promotions never affect a running experiment.
 */
import type {
  ProblemStructure, Mechanism, SearchPolicy, ConceptualMap,
  ExperimentRecord, Hypothesis, ExperimentCandidate, NoveltyAssessment,
  Usage, Budget, Domain,
} from '@agharta/shared';
import { addUsage, EMPTY_USAGE, budgetFor, ProblemInputSchema } from '@agharta/shared';
import type { ModelAdapter } from '../models';
import {
  InterpretationOutputSchema, HypothesisBatchSchema, InvestigationOutputSchema,
  RecombinationOutputSchema, NoveltyJudgeOutputSchema,
} from './boundary';
import { selectHypotheses } from '@agharta/learning';
import { SEED_MECHANISMS } from '@agharta/shared';
import { z } from 'zod';

export interface ExperimentInput {
  experimentId: string;
  workspaceId: string;
  problemId: string;
  problemText: string;
  domain: Domain;
  budgetPreset: 'quick' | 'standard' | 'deep';
  map: ConceptualMap;        // ACTIVE snapshot at start
  policy: SearchPolicy;      // ACTIVE snapshot at start
  seed: number;
}

export interface ExperimentOutput {
  record: ExperimentRecord;
  finalProposals: ExperimentRecord['finalProposals'];
}

const RefineOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  proposal: z.string().trim().min(1).max(4000),
  transferStory: z.string().trim().min(1).max(4000),
  differenceFromConventional: z.string().trim().min(1).max(2000),
  explorationStep: z.string().trim().min(1).max(2000),
  assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
});

/**
 * Run one full creative-search experiment. Bounded by budget; errors on
 * individual steps are recorded and don't lose the whole experiment.
 */
export async function runExperiment(
  model: ModelAdapter,
  input: ExperimentInput
): Promise<ExperimentOutput> {
  const budget = budgetFor(input.budgetPreset);
  const record: ExperimentRecord = {
    id: input.experimentId,
    workspaceId: input.workspaceId,
    problemId: input.problemId,
    problemText: input.problemText,
    problemStructure: null as unknown as ProblemStructure,
    domain: input.domain,
    budget,
    mapVersionId: input.map.versionId,
    policyVersionId: input.policy.versionId,
    status: 'interpreting',
    hypotheses: [],
    candidates: [],
    noveltyAssessments: [],
    finalProposals: [],
    usage: { ...EMPTY_USAGE },
    errors: [],
    modelInfo: { provider: model.providerId, model: model.modelId },
    startedAt: Date.now(),
  };

  // ---------- Step A: interpret ----------
  let structure: ProblemStructure;
  try {
    const res = await model.generate(
      {
        requestId: `${input.experimentId}:interpret`,
        operator: 'interpret',
        system: 'You interpret problems into structured representations for a creative-search engine. Return JSON.',
        prompt: `Problem: ${input.problemText}`,
      },
      InterpretationOutputSchema
    );
    structure = res.data;
    record.usage = addUsage(record.usage, res.usage);
  } catch (err) {
    record.errors.push(`interpret failed: ${errMsg(err)}`);
    record.status = 'failed';
    record.finishedAt = Date.now();
    return { record, finalProposals: [] };
  }
  record.problemStructure = structure;

  // ---------- Step B+C: consult policy, form hypotheses ----------
  record.status = 'hypothesizing';
  // candidate pool: mechanisms from the map (nodes carry mechanism payloads)
  const mapMechanisms = input.map.nodes
    .filter((n) => n.kind === 'mechanism' && n.mechanism)
    .map((n) => n.mechanism!);
  const pool = mapMechanisms.length > 0 ? mapMechanisms : SEED_MECHANISMS;
  const edgeIndex = new Map(input.map.edges.map((e) => [`${e.from}→${e.to}`, e]));
  const candidatesForPolicy = pool.map((m) => {
    const best = structure.structureTags
      .map((t) => edgeIndex.get(`tag:${t}→${m.id}`))
      .filter(Boolean);
    const compatMean = best.length
      ? best.reduce((a, e) => a + (e?.compatibility ?? 0.5), 0) / best.length
      : 0.5;
    return {
      mechanism: m,
      mapCompatibility: compatMean,
      evidenceCount: best.reduce((a, e) => a + (e?.automatedEvidenceCount ?? 0) + (e?.humanEvidenceCount ?? 0), 0),
    };
  });

  const selected = selectHypotheses(structure, candidatesForPolicy, input.policy, input.seed);

  // model drafts rationale/mappings for the SELECTED mechanisms
  let drafts: z.infer<typeof HypothesisBatchSchema>['hypotheses'] = [];
  try {
    const mechList = selected.map((s) => `Mechanism candidate: ${s.mechanism.id}`).join('\n');
    const res = await model.generate(
      {
        requestId: `${input.experimentId}:hypothesize`,
        operator: 'hypothesize',
        system: 'You form transfer hypotheses: why a mechanism may transfer to a problem. Return JSON.',
        prompt: `Problem objective: ${structure.objective}\nStructure tags: ${structure.structureTags.join(', ')}\n${mechList}\nFor each candidate, explain why the mechanism may transfer.`,
      },
      HypothesisBatchSchema
    );
    drafts = res.data.hypotheses;
    record.usage = addUsage(record.usage, res.usage);
  } catch (err) {
    record.errors.push(`hypothesize failed: ${errMsg(err)}`);
    drafts = [];
  }

  const draftById = new Map(drafts.map((d) => [d.mechanismId, d]));
  const hypotheses: Hypothesis[] = selected.map((s, idx) => {
    const d = draftById.get(s.mechanism.id);
    return {
      id: `hyp_${idx + 1}`,
      experimentId: input.experimentId,
      slot: s.slot,
      mechanismId: s.mechanism.id,
      mechanismField: s.mechanism.field,
      mechanismName: s.mechanism.name,
      transferRationale: d?.transferRationale ?? `Fallback rationale: ${s.mechanism.mechanism}`,
      structuralMapping: d?.structuralMapping ?? [
        { problemFeature: structure.structureTags[0] ?? 'core structure', mechanismElement: s.mechanism.mechanism.slice(0, 200), mappingConfidence: 0.4 },
      ],
      expectedProduce: d?.expectedProduce ?? 'A concrete transfer-based intervention.',
      invalidatingAssumptions: d?.invalidatingAssumptions ?? [`Problem satisfies: ${s.mechanism.appliesWhen.slice(0, 180)}`],
      policyScore: s.policyScore,
      selectionProbability: s.selectionProbability,
      status: 'selected',
    };
  });
  record.hypotheses = hypotheses;

  // ---------- Step D: investigate each hypothesis ----------
  record.status = 'investigating';
  let candSeq = 0;
  const survivors: Array<{ hypothesis: Hypothesis; candidates: ExperimentCandidate[] }> = [];
  for (const h of hypotheses) {
    if (h.status !== 'selected') continue;
    try {
      const mech = pool.find((m) => m.id === h.mechanismId)!;
      const res = await model.generate(
        {
          requestId: `${input.experimentId}:investigate:${h.id}`,
          operator: 'investigate',
          system: 'You investigate a transfer hypothesis: extract the causal principle, map it, generate candidates, critique. Return JSON.',
          prompt: `Mechanism: ${mech.id} (${mech.name}, ${mech.field}) — ${mech.mechanism}\nProblem objective: ${structure.objective}\nConventional solutions: ${structure.conventionalSolutions.join('; ')}\nHypothesis rationale: ${h.transferRationale}`,
        },
        InvestigationOutputSchema
      );
      record.usage = addUsage(record.usage, res.usage);
      const produced: ExperimentCandidate[] = res.data.candidates.map((c) => ({
        id: `cand_${++candSeq}`,
        experimentId: input.experimentId,
        hypothesisId: h.id,
        title: c.title,
        proposal: c.proposal,
        transferStory: c.transferStory,
          differenceFromConventional: c.differenceFromConventional,
        explorationStep: c.explorationStep,
        assumptions: c.assumptions,
        limitations: c.limitations,
        stage: 'generated',
      }));
      record.candidates.push(...produced);
      if (res.data.critique.survived) {
        for (const c of produced) c.stage = 'critiqued';
        survivors.push({ hypothesis: h, candidates: produced });
        h.status = 'investigated';
      } else {
        for (const cc of produced) { cc.stage = 'discarded'; cc.discardReason = 'critique: transfer invalid'; }
        h.status = 'rejected';
        h.rejectionReason = `critique rejected: ${res.data.critique.coherenceNotes.slice(0, 200)}`;
      }
    } catch (err) {
      h.status = 'error';
      record.errors.push(`investigate ${h.id} failed: ${errMsg(err)}`);
    }
  }

  // ---------- recombination of survivors from DIFFERENT hypotheses ----------
  if (survivors.length >= 2 && record.candidates.filter((c) => c.stage !== 'discarded').length < budget.maxCandidates) {
    try {
      const mechLines = survivors.slice(0, 3).map(({ hypothesis }) => {
        const mech = pool.find((m) => m.id === hypothesis.mechanismId)!;
        return `Mechanism: ${mech.id} (${mech.name})`;
      }).join('\n');
      const res = await model.generate(
        {
          requestId: `${input.experimentId}:recombine`,
          operator: 'recombine',
          system: 'You combine surviving transfers into a stronger hybrid hypothesis. Return JSON.',
          prompt: `Problem objective: ${structure.objective}\n${mechLines}\nCombine complementary mechanisms.`,
        },
        RecombinationOutputSchema
      );
      record.usage = addUsage(record.usage, res.usage);
      for (const c of res.data.candidates) {
        record.candidates.push({
          id: `cand_${++candSeq}`,
          experimentId: input.experimentId,
          hypothesisId: survivors[0]!.hypothesis.id,
          parentHypothesisIds: c.parentHypothesisIds.length >= 2 ? c.parentHypothesisIds : survivors.slice(0, 2).map((s) => s.hypothesis.id),
          title: c.title,
          proposal: c.proposal,
          transferStory: c.transferStory,
          differenceFromConventional: c.differenceFromConventional,
          explorationStep: c.explorationStep,
          assumptions: c.assumptions,
          limitations: c.limitations,
          stage: 'generated',
        });
      }
    } catch (err) {
      record.errors.push(`recombine failed: ${errMsg(err)}`);
    }
  }

  // ---------- Step E: evaluate novelty ----------
  record.status = 'evaluating';
  const activeCandidates = record.candidates.filter((c) => c.stage !== 'discarded');
  const siblingTitles = activeCandidates.map((c) => c.title).join(' | ');
  for (const c of activeCandidates) {
    try {
      const res = await model.generate(
        {
          requestId: `${input.experimentId}:novelty:${c.id}`,
          operator: 'novelty_judge',
          system: 'You assess novelty on multiple reference points. Return JSON.',
          prompt: `Candidate: ${c.title} — ${c.proposal.slice(0, 400)}\nConventional solutions: ${structure.conventionalSolutions.join('; ')}\nSibling candidates: ${siblingTitles.slice(0, 1000)}\nAssess vs conventional, vs siblings, transfer distance, substantive difference, coherence, relevance.`,
        },
        NoveltyJudgeOutputSchema
      );
      record.usage = addUsage(record.usage, res.usage);
      const a = res.data;
      record.noveltyAssessments.push({
        candidateId: c.id,
        vsConventional: a.vsConventional,
        vsSiblings: a.vsSiblings,
        transferDistance: a.transferDistance,
        substantiveDifference: a.substantiveDifference,
        coherence: a.coherence,
        relevance: a.relevance,
        uncertainty: a.uncertainty,
        justification: a.justification,
        evaluatorId: model.providerId,
        evaluatorVersion: model.modelId,
      });
      // coherence gate: discard incoherent candidates (novelty alone insufficient)
      if (a.coherence < 0.4 || a.relevance < 0.4) {
        c.stage = 'discarded';
        c.discardReason = `coherence gate: coherence=${a.coherence} relevance=${a.relevance}`;
      }
    } catch (err) {
      record.errors.push(`novelty judge ${c.id} failed: ${errMsg(err)}`);
    }
  }

  // ---------- Step F: refine top-novel candidates ----------
  record.status = 'refining';
  const assessmentByCandidate = new Map(record.noveltyAssessments.map((a) => [a.candidateId, a]));
  const ranked = record.candidates
    .filter((c) => c.stage !== 'discarded')
    .map((c) => ({ c, novelty: noveltyScore(assessmentByCandidate.get(c.id)) }))
    .filter((x) => x.novelty !== null)
    .sort((a, b) => (b.novelty ?? 0) - (a.novelty ?? 0));
  const topK = Math.min(3, ranked.length);
  const finals: ExperimentRecord['finalProposals'] = [];
  for (let i = 0; i < topK; i++) {
    const { c } = ranked[i]!;
    try {
      const mech = pool.find((m) => m.id === record.hypotheses.find((h) => h.id === c.hypothesisId)?.mechanismId);
      const res = await model.generate(
        {
          requestId: `${input.experimentId}:refine:${c.id}`,
          operator: 'refine',
          system: 'You deepen the most novel coherent candidate into a final proposal. Return JSON.',
          prompt: `Mechanism: ${mech?.id ?? 'sc_immune'} (${mech?.name ?? ''})\nCandidate: ${c.title} — ${c.proposal.slice(0, 400)}\nRefine into the strongest version.`,
        },
        RefineOutputSchema
      );
      record.usage = addUsage(record.usage, res.usage);
      c.stage = 'refined';
      c.proposal = res.data.proposal;
      c.transferStory = res.data.transferStory;
      c.differenceFromConventional = res.data.differenceFromConventional;
      c.explorationStep = res.data.explorationStep;
      finals.push({
        candidateId: c.id,
        title: res.data.title,
        proposal: res.data.proposal,
        mechanismField: mech?.field ?? 'unknown',
        novelty: noveltyScore(assessmentByCandidate.get(c.id)) ?? 3,
      });
    } catch (err) {
      record.errors.push(`refine ${c.id} failed: ${errMsg(err)}`);
      // still include the unrefined candidate as final
      finals.push({
        candidateId: c.id,
        title: c.title,
        proposal: c.proposal,
        mechanismField: record.hypotheses.find((h) => h.id === c.hypothesisId)?.mechanismField ?? 'unknown',
        novelty: noveltyScore(assessmentByCandidate.get(c.id)) ?? 3,
      });
    }
  }
  for (const f of finals) {
    const c = record.candidates.find((x) => x.id === f.candidateId);
    if (c) c.stage = 'final';
  }
  record.finalProposals = finals;
  record.status = 'completed';
  record.finishedAt = Date.now();
  return { record, finalProposals: record.finalProposals };
}

function noveltyScore(a: NoveltyAssessment | undefined): number | null {
  if (!a) return null;
  return (
    a.vsConventional * 0.3 +
    a.vsSiblings * 0.15 +
    a.transferDistance * 0.25 +
    a.substantiveDifference * 0.3
  );
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300);
  return String(err).slice(0, 300);
}
