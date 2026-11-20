/**
 * AGHARTA V2 contracts — experimental creative search.
 *
 * The central objects:
 *   - ProblemStructure: what a problem IS, structurally (not just prose)
 *   - Mechanism: a specific transferable causal mechanism from a field
 *   - Hypothesis: "mechanism M may transfer to problem structure S"
 *   - Experiment: the full record of one creative search
 *   - ConceptualMap / SearchPolicy: versioned learning artifacts
 *
 * Everything Zod-validated at model boundaries. Pure: no SDKs.
 */
import { z } from 'zod';
import { DomainSchema, BudgetSchema, UsageSchema, FeedbackActionSchema } from './contracts';

// ---------------------------------------------------------------------------
// Problem structure (Engine 1 step A)
// ---------------------------------------------------------------------------

// Structure tags are an OPEN vocabulary (Engine 2 may propose new tags),
// seeded from a starter set in packages/core/src/search/seedTags.ts.
export type StructureTag = string;
export const SEED_STRUCTURE_TAGS = [
  'allocation', 'matching', 'search', 'signaling', 'coordination', 'bottleneck',
  'feedback_loop', 'trust', 'incentive_misalignment', 'scarcity', 'risk_allocation',
  'sequencing', 'redundancy', 'filtering', 'prioritization', 'discovery',
  'adoption', 'retention', 'coverage', 'timing', 'group_decision', 'information_asymmetry',
] as const;

export const ProblemStructureSchema = z.object({
  /** plain-language objective */
  objective: z.string().trim().min(1).max(2000),
  /** open vocabulary of structural descriptors (seeded, evolvable) */
  structureTags: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  actors: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  incentives: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  resources: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  obstacles: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  /** conventional answers the user wants to move beyond */
  conventionalSolutions: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  previouslyTried: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  /** 1–5 self-assessed confidence in this interpretation */
  interpretationConfidence: z.number().int().min(1).max(5),
});
export type ProblemStructure = z.infer<typeof ProblemStructureSchema>;

// ---------------------------------------------------------------------------
// Mechanisms (the transferable units — supersedes "source concepts" as the
// central object; the curated library seeds the map)
// ---------------------------------------------------------------------------

export const MechanismSchema = z.object({
  id: z.string().min(1),
  field: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  /** the SPECIFIC causal structure that transfers — not "borrow biology" */
  mechanism: z.string().trim().min(1).max(2000),
  /** when this mechanism tends to apply */
  appliesWhen: z.string().trim().min(1).max(1000),
  provenance: z.enum(['curated', 'experiment_discovered', 'model_proposed']),
  sourceUri: z.string().url().optional(),
  verified: z.boolean(),
});
export type Mechanism = z.infer<typeof MechanismSchema>;

// ---------------------------------------------------------------------------
// Hypotheses (Engine 1 step C)
// ---------------------------------------------------------------------------

export const HypothesisSlotSchema = z.enum([
  'exploitation', // guided by learned compatibility
  'exploration',  // uncertain or distant region (mandatory floor)
  'wildcard',     // challenges the problem framing itself
]);
export type HypothesisSlot = z.infer<typeof HypothesisSlotSchema>;

export const HypothesisSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  slot: HypothesisSlotSchema,
  mechanismId: z.string().min(1),
  mechanismField: z.string().min(1).max(80),
  mechanismName: z.string().min(1).max(200),
  /** why this mechanism may transfer */
  transferRationale: z.string().trim().min(1).max(2000),
  /** structural mapping: problem feature ↔ mechanism element */
  structuralMapping: z.array(
    z.object({
      problemFeature: z.string().trim().min(1).max(300),
      mechanismElement: z.string().trim().min(1).max(300),
      mappingConfidence: z.number().min(0).max(1),
    })
  ).min(1).max(8),
  /** what the transfer might produce if it works */
  expectedProduce: z.string().trim().min(1).max(1000),
  /** assumptions that would invalidate the transfer */
  invalidatingAssumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  /** learned-policy context at selection time (for bias correction) */
  policyScore: z.number().min(0).max(1),
  /** logged selection probability under the policy (selection-bias correction) */
  selectionProbability: z.number().min(0).max(1),
  status: z.enum(['selected', 'investigated', 'rejected', 'duplicate', 'error']),
  /** why it was rejected, when it was */
  rejectionReason: z.string().max(1000).optional(),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

// ---------------------------------------------------------------------------
// Experiment candidates and novelty evaluation
// ---------------------------------------------------------------------------

export const ExperimentCandidateSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  hypothesisId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  /** the concrete proposal */
  proposal: z.string().trim().min(1).max(4000),
  /** the mechanism story: how the source mechanism becomes the intervention */
  transferStory: z.string().trim().min(1).max(4000),
  /** why this differs from conventional approaches */
  differenceFromConventional: z.string().trim().min(1).max(2000),
  /** how the user could explore/test it concretely */
  explorationStep: z.string().trim().min(1).max(2000),
  assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  stage: z.enum(['generated', 'critiqued', 'refined', 'final', 'discarded']),
  discardReason: z.string().max(1000).optional(),
  /** recombination provenance (parent hypotheses combined into this candidate) */
  parentHypothesisIds: z.array(z.string().min(1)).max(3).optional(),
});
export type ExperimentCandidate = z.infer<typeof ExperimentCandidateSchema>;

export const NoveltyAssessmentSchema = z.object({
  candidateId: z.string().min(1),
  /** 1–5: distance from conventional solutions */
  vsConventional: z.number().int().min(1).max(5),
  /** 1–5: distance from siblings in the same experiment */
  vsSiblings: z.number().int().min(1).max(5),
  /** 1–5: conceptual distance of the transfer itself */
  transferDistance: z.number().int().min(1).max(5),
  /** 1–5: is it substantively different, not a rewording? */
  substantiveDifference: z.number().int().min(1).max(5),
  /** 0–1: coherence gate — logically/causally plausible and relevant */
  coherence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  justification: z.string().trim().min(1).max(2000),
  evaluatorId: z.string().min(1),
  evaluatorVersion: z.string().min(1),
});
export type NoveltyAssessment = z.infer<typeof NoveltyAssessmentSchema>;

/** composite novelty — computed by code from the assessment, with evidence kept */
export function noveltyComposite(a: NoveltyAssessment): number {
  // novelty is the objective; coherence/relevance are gates applied outside
  const raw = a.vsConventional * 0.3 + a.vsSiblings * 0.15 + a.transferDistance * 0.25 + a.substantiveDifference * 0.3;
  return Math.round(raw * 100) / 100; // 1..5
}

// ---------------------------------------------------------------------------
// Experiment record (Engine 1 step G)
// ---------------------------------------------------------------------------

export const ExperimentStatusSchema = z.enum([
  'queued', 'interpreting', 'hypothesizing', 'investigating', 'evaluating',
  'refining', 'completed', 'failed', 'cancelled',
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  problemId: z.string().min(1),
  /** raw user problem text (preserved) */
  problemText: z.string().min(1),
  /** structured interpretation (step A output) */
  problemStructure: ProblemStructureSchema,
  domain: DomainSchema,
  budget: BudgetSchema,
  /** artifacts snapshot used for this run (never changes mid-run) */
  mapVersionId: z.string().min(1),
  policyVersionId: z.string().min(1),
  status: ExperimentStatusSchema,
  hypotheses: z.array(HypothesisSchema).default([]),
  candidates: z.array(ExperimentCandidateSchema).default([]),
  noveltyAssessments: z.array(NoveltyAssessmentSchema).default([]),
  /** 2–3 final outputs */
  finalProposals: z.array(z.object({
    candidateId: z.string().min(1),
    title: z.string().min(1).max(200),
    proposal: z.string().min(1),
    mechanismField: z.string().min(1),
    novelty: z.number().min(1).max(5),
  })).default([]),
  usage: UsageSchema,
  errors: z.array(z.string()).default([]),
  modelInfo: z.record(z.string(), z.string()).default({}),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;

// ---------------------------------------------------------------------------
// Engine 2 artifacts — versioned, immutable
// ---------------------------------------------------------------------------

export const MapNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['structure_tag', 'mechanism', 'transfer_type']),
  label: z.string().trim().min(1).max(200),
  /** embedding bucket id (hashed projection) for fast coarse similarity */
  embBucket: z.string().min(1),
  /** mechanism payload for mechanism nodes */
  mechanism: MechanismSchema.optional(),
});
export type MapNode = z.infer<typeof MapNodeSchema>;

export const MapEdgeSchema = z.object({
  /** structure tag id → mechanism id */
  from: z.string().min(1),
  to: z.string().min(1),
  /** LEARNED compatibility 0..1 (posterior mean at fit time) */
  compatibility: z.number().min(0).max(1),
  /** evidence behind this edge */
  alpha: z.number().min(0),
  beta: z.number().min(0),
  /** how much of alpha/beta comes from human/outcome tiers vs automated */
  humanEvidenceCount: z.number().int().min(0),
  automatedEvidenceCount: z.number().int().min(0),
  lastUpdatedByLearningRun: z.string().min(1).optional(),
});
export type MapEdge = z.infer<typeof MapEdgeSchema>;

export const ConceptualMapSchema = z.object({
  versionId: z.string().min(1),
  /** semver-ish: map-v{major}.{minor} */
  version: z.string().min(1).regex(/^map-v\d+\.\d+$/),
  createdAt: z.number(),
  nodes: z.array(MapNodeSchema),
  edges: z.array(MapEdgeSchema),
  /** learning-run provenance */
  createdByLearningRun: z.string().min(1).optional(),
  parentVersionId: z.string().optional(),
});
export type ConceptualMap = z.infer<typeof ConceptualMapSchema>;

export const SearchPolicySchema = z.object({
  versionId: z.string().min(1),
  version: z.string().min(1).regex(/^policy-v\d+\.\d+$/),
  createdAt: z.number(),
  /** logistic-regression weights over joint features (hashed) */
  compatWeights: z.record(z.string(), z.number()),
  compatBias: z.number(),
  /** 0..1 preference for conceptually distant transfers (learned) */
  distancePreference: z.number().min(0).max(1),
  /** exploitation/exploration/wildcard slot counts (policy-tunable) */
  slots: z.object({
    exploitation: z.number().int().min(1).max(10),
    exploration: z.number().int().min(1).max(10),
    wildcard: z.number().int().min(1).max(3),
  }),
  /** hard floor — learning cannot reduce below this */
  explorationFloor: z.number().min(0.05).max(1),
  /** per-field Beta-Bernoulli posteriors (novel+coherent outcomes) */
  fieldPosteriors: z.record(
    z.string(),
    z.object({ alpha: z.number().min(0), beta: z.number().min(0) })
  ),
  createdByLearningRun: z.string().min(1).optional(),
  parentVersionId: z.string().optional(),
});
export type SearchPolicy = z.infer<typeof SearchPolicySchema>;

// ---------------------------------------------------------------------------
// Learning runs + evaluations (Engine 2 bookkeeping)
// ---------------------------------------------------------------------------

export const LearningRunStatusSchema = z.enum([
  'pending', 'fitting', 'evaluating', 'promoted', 'retained', 'failed',
]);
export type LearningRunStatus = z.infer<typeof LearningRunStatusSchema>;

export const ArtifactEvaluationSchema = z.object({
  id: z.string().min(1),
  learningRunId: z.string().min(1),
  championMetrics: z.object({
    meanNovelty: z.number().min(0),
    meanCoherence: z.number().min(0).max(1),
    perProblem: z.array(z.object({ problemId: z.string(), novelty: z.number(), coherence: z.number() })),
  }),
  challengerMetrics: z.object({
    meanNovelty: z.number().min(0),
    meanCoherence: z.number().min(0).max(1),
    perProblem: z.array(z.object({ problemId: z.string(), novelty: z.number(), coherence: z.number() })),
  }),
  /** posterior probability challenger > champion (paired) */
  challengerBetterProb: z.number().min(0).max(1),
  seeds: z.array(z.number()),
  problemIds: z.array(z.string()),
  passed: z.boolean(),
  reasons: z.array(z.string()),
});
export type ArtifactEvaluation = z.infer<typeof ArtifactEvaluationSchema>;

// ---------------------------------------------------------------------------
// Experiment observation — what Engine 2 learns from
// ---------------------------------------------------------------------------

export const HypothesisOutcomeSchema = z.object({
  hypothesisId: z.string().min(1),
  experimentId: z.string().min(1),
  mechanismId: z.string().min(1),
  mechanismField: z.string().min(1),
  structureTags: z.array(z.string()),
  slot: HypothesisSlotSchema,
  /** automated tier */
  producedNovelCoherent: z.boolean(),
  bestNovelty: z.number().min(0),
  duplicateOutcomes: z.number().int().min(0),
  incoherentOutcomes: z.number().int().min(0),
  candidateCount: z.number().int().min(0),
  /** human tier (from feedback linking) */
  humanShortlisted: z.number().int().min(0).default(0),
  humanRejected: z.number().int().min(0).default(0),
  /** selection-bias correction inputs */
  policyScore: z.number().min(0).max(1),
  selectionProbability: z.number().min(0).max(1),
});
export type HypothesisOutcome = z.infer<typeof HypothesisOutcomeSchema>;

export const ExperimentObservationSchema = z.object({
  experimentId: z.string().min(1),
  workspaceId: z.string().min(1),
  problemStructure: ProblemStructureSchema,
  domain: DomainSchema,
  hypothesisOutcomes: z.array(HypothesisOutcomeSchema),
  feedbackActions: z.array(z.object({ candidateId: z.string(), action: FeedbackActionSchema })),
  observedAt: z.number(),
});
export type ExperimentObservation = z.infer<typeof ExperimentObservationSchema>;
