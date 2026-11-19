/**
 * AGHARTA shared contracts — model-independent Zod schemas + inferred types.
 * Pure: no browser SDKs, no React, no Convex imports.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const DomainSchema = z.enum([
  'product',
  'engineering',
  'business',
  'policy',
  'personal',
  'other',
]);
export type Domain = z.infer<typeof DomainSchema>;
export const DOMAINS = DomainSchema.options;

export const OperatorIdSchema = z.enum([
  'divergent',
  'analogy',
  'inversion',
  'recombination',
]);
export type OperatorId = z.infer<typeof OperatorIdSchema>;
export const OPERATOR_IDS = OperatorIdSchema.options;

export const BudgetPresetSchema = z.enum(['quick', 'standard', 'deep']);
export type BudgetPreset = z.infer<typeof BudgetPresetSchema>;

/** Evidence tiers — never merge these unlabeled. */
export const EvidenceKindSchema = z.enum([
  'automated_proxy',
  'human_rating',
  'external_test',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const VerificationStatusSchema = z.enum([
  'self_reported',
  'verified',
  'unverified',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const FeedbackActionSchema = z.enum([
  'shortlisted',
  'rejected',
  'attempted',
  'succeeded',
  'failed',
]);
export type FeedbackAction = z.infer<typeof FeedbackActionSchema>;

/** Bounded non-empty text used everywhere for user/model-authored fields. */
const boundedText = (max: number, fieldName: string) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} must not be empty`)
    .max(max, `${fieldName} exceeds ${max} characters`);

const stringId = (label: string) => z.string().min(1, `${label} required`);

// ---------------------------------------------------------------------------
// Problem
// ---------------------------------------------------------------------------

export const ProblemInputSchema = z.object({
  title: boundedText(200, 'title'),
  description: boundedText(8000, 'description'),
  desiredOutcome: boundedText(2000, 'desiredOutcome'),
  constraints: z.array(boundedText(500, 'constraint')).max(20).default([]),
  domain: DomainSchema.default('other'),
  previouslyTried: z.array(boundedText(2000, 'previouslyTried')).max(20).default([]),
});
export type ProblemInput = z.infer<typeof ProblemInputSchema>;

// ---------------------------------------------------------------------------
// Source concepts (analogy library)
// ---------------------------------------------------------------------------

export const SourceConceptSchema = z.object({
  id: stringId('source concept id'),
  domain: boundedText(80, 'domain'),
  name: boundedText(200, 'name'),
  description: boundedText(2000, 'description'),
  /** The causal structure that could transfer. */
  transferableMechanism: boundedText(2000, 'transferableMechanism'),
  provenance: z.enum(['curated', 'model_generated']),
  sourceUri: z.string().url().optional(),
  /** Curated concepts are human-verified; model_generated are not. */
  verified: z.boolean(),
});
export type SourceConcept = z.infer<typeof SourceConceptSchema>;

/** What an analogy operator records about using a source concept. */
export const IdeaSourceUseSchema = z.object({
  sourceConceptId: stringId('source concept id'),
  /** 0..1 lexical/embedding distance between problem and source (heuristic, not calibrated semantic distance). */
  distance: z.number().min(0).max(1).optional(),
  mappingNotes: z.string().max(2000).optional(),
});
export type IdeaSourceUse = z.infer<typeof IdeaSourceUseSchema>;

// ---------------------------------------------------------------------------
// Idea
// ---------------------------------------------------------------------------

export const IdeaSchema = z.object({
  id: stringId('idea id'),
  explorationId: stringId('exploration id'),
  title: boundedText(200, 'title'),
  intervention: boundedText(4000, 'intervention'),
  /** Why it might work — the causal story. */
  causalMechanism: boundedText(4000, 'causalMechanism'),
  assumptions: z.array(boundedText(1000, 'assumption')).min(1).max(12),
  failureModes: z.array(boundedText(1000, 'failureMode')).min(1).max(12),
  proposedTest: boundedText(4000, 'proposedTest'),
  operatorId: OperatorIdSchema,
  parentIds: z.array(stringId('parent id')).max(4).default([]),
  sourceConceptIds: z.array(stringId('source concept id')).max(8).default([]),
  mechanismId: z.string().min(1).optional(),
  generation: z.number().int().min(0).max(10),
  /** Which constraint the inversion operator flipped (provenance). */
  invertedConstraint: z.string().max(500).optional(),
  /** Whether the inverted-constraint proposal survived repair to hard constraints. */
  survivedRepair: z.boolean().optional(),
});
export type Idea = z.infer<typeof IdeaSchema>;

/**
 * Operator output at the model boundary — parsed with Zod, never trusted raw.
 * IDs (idea/exploration) and lineage are assigned by the engine, not the model.
 */
export const OperatorOutputSchema = z.object({
  title: boundedText(200, 'title'),
  intervention: boundedText(4000, 'intervention'),
  causalMechanism: boundedText(4000, 'causalMechanism'),
  assumptions: z.array(boundedText(1000, 'assumption')).min(1).max(12),
  failureModes: z.array(boundedText(1000, 'failureMode')).min(1).max(12),
  proposedTest: boundedText(4000, 'proposedTest'),
  // operator-specific provenance (engine validates referenced IDs exist)
  sourceConceptIds: z.array(stringId('source concept id')).max(8).default([]),
  invertedConstraint: z.string().max(500).optional(),
  survivedRepair: z.boolean().optional(),
});
export type OperatorOutput = z.infer<typeof OperatorOutputSchema>;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** 1–5 rubric-anchored score. */
export const RubricScoreSchema = z.number().int().min(1).max(5);
export type RubricScore = z.infer<typeof RubricScoreSchema>;

export const EvaluationSchema = z.object({
  ideaId: stringId('idea id'),
  evaluator: stringId('evaluator'),
  evaluatorVersion: stringId('evaluator version'),
  originality: RubricScoreSchema,
  usefulness: RubricScoreSchema,
  feasibility: RubricScoreSchema,
  /** Only meaningful for analogy-derived ideas. */
  structuralValidity: RubricScoreSchema.optional(),
  /** 0..1 — judge's self-assessed uncertainty for this item. */
  uncertainty: z.number().min(0).max(1),
  justification: boundedText(4000, 'justification'),
  evidenceKind: EvidenceKindSchema,
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/** Heuristic aggregate used ONLY for ranking display, never as truth. */
export function proxyScore(e: Pick<Evaluation, 'originality' | 'usefulness' | 'feasibility'>): number {
  return round2(e.originality * 0.4 + e.usefulness * 0.4 + e.feasibility * 0.2);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const BudgetSchema = z.object({
  preset: BudgetPresetSchema,
  maxCandidates: z.number().int().min(4).max(96),
  maxGenerations: z.number().int().min(1).max(5),
  maxCostUsd: z.number().min(0.01),
  maxWallClockMs: z.number().int().min(1000),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BUDGET_PRESETS: Record<BudgetPreset, Omit<Budget, 'preset'>> = {
  quick: { maxCandidates: 8, maxGenerations: 1, maxCostUsd: 0.5, maxWallClockMs: 120_000 },
  standard: { maxCandidates: 24, maxGenerations: 2, maxCostUsd: 1.5, maxWallClockMs: 300_000 },
  deep: { maxCandidates: 48, maxGenerations: 3, maxCostUsd: 3, maxWallClockMs: 600_000 },
};

export function budgetFor(preset: BudgetPreset, overrides?: Partial<Omit<Budget, 'preset'>>): Budget {
  return { preset, ...BUDGET_PRESETS[preset], ...overrides };
}

// ---------------------------------------------------------------------------
// Usage / cost accounting
// ---------------------------------------------------------------------------

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  modelCalls: z.number().int().min(0),
  wallClockMs: z.number().int().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;
export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  modelCalls: 0,
  wallClockMs: 0,
};
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: round4(a.costUsd + b.costUsd),
    modelCalls: a.modelCalls + b.modelCalls,
    wallClockMs: a.wallClockMs + b.wallClockMs,
  };
}
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export const SearchStrategySchema = z.object({
  id: stringId('strategy id'),
  version: stringId('strategy version'),
  isChampion: z.boolean(),
  /** 0..1 relative allocation per operator (sums to 1 after normalization). */
  operatorWeights: z.record(OperatorIdSchema, z.number().min(0).max(1)),
  populationSize: z.number().int().min(4).max(64),
  maxGenerations: z.number().int().min(1).max(5),
  /** Fraction of generation opportunities reserved for underexplored operators. */
  explorationFloor: z.number().min(0).max(1),
  maxTokens: z.number().int().min(1000),
  maxCostUsd: z.number().min(0.01),
  prompts: z.record(OperatorIdSchema, z.string().min(1).max(8000)),
  modelAssignments: z.record(z.string(), z.string().min(1)),
});
export type SearchStrategy = z.infer<typeof SearchStrategySchema>;

// ---------------------------------------------------------------------------
// Mechanisms (conceptual causal approaches)
// ---------------------------------------------------------------------------

export const MechanismStatusSchema = z.enum(['champion', 'challenger', 'dormant', 'invalid']);
export type MechanismStatus = z.infer<typeof MechanismStatusSchema>;

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const FeedbackEventSchema = z.object({
  ideaId: stringId('idea id'),
  action: FeedbackActionSchema,
  reason: z.string().max(2000).optional(),
  evidence: z.string().max(4000).optional(),
  outcomeMetric: z.string().max(1000).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
});
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;
