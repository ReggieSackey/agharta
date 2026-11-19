import { describe, expect, it } from 'vitest';
import {
  BudgetSchema,
  EvaluationSchema,
  FeedbackEventSchema,
  IdeaSchema,
  OperatorOutputSchema,
  ProblemInputSchema,
  SearchStrategySchema,
  budgetFor,
  proxyScore,
} from '../src/index';

const validIdea = {
  id: 'idea_1',
  explorationId: 'ex_1',
  title: 'Load-shed requests by staleness',
  intervention: 'Drop stale requests first when saturation detected',
  causalMechanism: 'Stale responses have lower marginal value, so shedding them preserves fresh utility',
  assumptions: ['Staleness is measurable at the edge'],
  failureModes: ['Staleness signal unavailable'],
  proposedTest: 'Shadow-mode shed 5% for a week, compare p99 and utility proxy',
  operatorId: 'divergent',
  parentIds: [],
  sourceConceptIds: [],
  generation: 0,
};

const validEvaluation = {
  ideaId: 'idea_1',
  evaluator: 'model-judge',
  evaluatorVersion: 'v1',
  originality: 4,
  usefulness: 3,
  feasibility: 5,
  uncertainty: 0.3,
  justification: 'Clear causal chain, moderate novelty.',
  evidenceKind: 'automated_proxy',
};

const validStrategy = {
  id: 's1',
  version: '0.1',
  isChampion: true,
  operatorWeights: { divergent: 0.4, analogy: 0.3, inversion: 0.2, recombination: 0.1 },
  populationSize: 8,
  maxGenerations: 2,
  explorationFloor: 0.1,
  maxTokens: 100000,
  maxCostUsd: 2,
  prompts: {
    divergent: 'p',
    analogy: 'p',
    inversion: 'p',
    recombination: 'p',
  },
  modelAssignments: { creative: 'fake', judge: 'fake' },
};

describe('contracts: idea', () => {
  it('accepts a well-formed idea', () => {
    expect(IdeaSchema.safeParse(validIdea).success).toBe(true);
  });
  it('rejects empty title (whitespace-only)', () => {
    expect(IdeaSchema.safeParse({ ...validIdea, title: '   ' }).success).toBe(false);
  });
  it('rejects unknown operatorId', () => {
    expect(IdeaSchema.safeParse({ ...validIdea, operatorId: 'mutation' }).success).toBe(false);
  });
  it('rejects empty assumptions array', () => {
    expect(IdeaSchema.safeParse({ ...validIdea, assumptions: [] }).success).toBe(false);
  });
  it('caps parent count', () => {
    expect(
      IdeaSchema.safeParse({ ...validIdea, parentIds: ['a', 'b', 'c', 'd', 'e'] }).success
    ).toBe(false);
  });
});

describe('contracts: operator output boundary', () => {
  it('rejects malformed operator output missing failureModes', () => {
    const bad: Record<string, unknown> = { ...validIdea };
    delete bad.failureModes;
    expect(OperatorOutputSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts well-formed operator output', () => {
    expect(OperatorOutputSchema.safeParse(validIdea).success).toBe(true);
  });
});

describe('contracts: evaluation', () => {
  it('accepts a valid evaluation', () => {
    expect(EvaluationSchema.safeParse(validEvaluation).success).toBe(true);
  });
  it('rejects out-of-range scores', () => {
    expect(EvaluationSchema.safeParse({ ...validEvaluation, originality: 6 }).success).toBe(false);
    expect(EvaluationSchema.safeParse({ ...validEvaluation, usefulness: 0 }).success).toBe(false);
  });
  it('rejects out-of-range uncertainty', () => {
    expect(EvaluationSchema.safeParse({ ...validEvaluation, uncertainty: 1.5 }).success).toBe(false);
  });
});

describe('contracts: problem input', () => {
  it('defaults constraints, domain, previouslyTried', () => {
    const parsed = ProblemInputSchema.parse({
      title: 'T',
      description: 'D',
      desiredOutcome: 'O',
    });
    expect(parsed.domain).toBe('other');
    expect(parsed.constraints).toEqual([]);
    expect(parsed.previouslyTried).toEqual([]);
  });
  it('rejects oversized constraint lists', () => {
    expect(
      ProblemInputSchema.safeParse({
        title: 'T',
        description: 'D',
        desiredOutcome: 'O',
        constraints: Array(25).fill('c'),
      }).success
    ).toBe(false);
  });
});

describe('contracts: budgets', () => {
  it('quick preset is 8 candidates / 1 generation', () => {
    const b = budgetFor('quick');
    expect(BudgetSchema.parse(b)).toEqual(b);
    expect(b.maxCandidates).toBe(8);
    expect(b.maxGenerations).toBe(1);
  });
  it('overrides apply', () => {
    expect(budgetFor('quick', { maxCostUsd: 0.2 }).maxCostUsd).toBe(0.2);
  });
});

describe('contracts: strategy', () => {
  it('accepts a complete strategy', () => {
    expect(SearchStrategySchema.safeParse(validStrategy).success).toBe(true);
  });
  it('rejects strategy with missing operator prompt', () => {
    expect(
      SearchStrategySchema.safeParse({
        ...validStrategy,
        prompts: { divergent: 'p' },
      }).success
    ).toBe(false);
  });
});

describe('proxyScore', () => {
  it('is bounded 1..5', () => {
    expect(proxyScore({ originality: 1, usefulness: 1, feasibility: 1 })).toBe(1);
    expect(proxyScore({ originality: 5, usefulness: 5, feasibility: 5 })).toBe(5);
  });
});

describe('contracts: feedback', () => {
  it('accepts optional evidence fields', () => {
    expect(FeedbackEventSchema.safeParse({ ideaId: 'i', action: 'succeeded' }).success).toBe(true);
  });
  it('rejects unknown action', () => {
    expect(FeedbackEventSchema.safeParse({ ideaId: 'i', action: 'exploded' }).success).toBe(false);
  });
});
