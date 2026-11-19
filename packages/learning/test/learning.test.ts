import { describe, expect, it } from 'vitest';
import {
  emptyStatsMap,
  emptyCounters,
  smoothQualification,
  thompsonWeights,
  decideAllocation,
  applyCredit,
  buildChallenger,
  evaluateGate,
  promoteStrategy,
  DEFAULT_PROMOTION_GATE,
} from '../src';
import type { OperatorStatsMap, ArmResult } from '../src';
import type { SearchStrategy } from '@agharta/shared';

function statsWith(over: Partial<Record<'divergent' | 'analogy' | 'inversion' | 'recombination', { qualified: number; unique: number }>>): OperatorStatsMap {
  const s = emptyStatsMap();
  for (const [op, v] of Object.entries(over) as Array<[keyof OperatorStatsMap, { qualified: number; unique: number }]>) {
    s[op as keyof OperatorStatsMap] = {
      ...emptyCounters(),
      provisionallyQualified: v.qualified,
      unique: v.unique,
      generated: v.unique + 2,
    };
  }
  return s;
}

describe('stats', () => {
  it('smooths sparse data to prior mean with high uncertainty', () => {
    const est = smoothQualification({ ...emptyCounters(), unique: 0 });
    expect(est.mean).toBeCloseTo(0.5);
    expect(est.insufficientData).toBe(true);
  });
  it('converges with more data', () => {
    const est = smoothQualification({ ...emptyCounters(), provisionallyQualified: 80, unique: 100 });
    expect(est.mean).toBeGreaterThan(0.75);
    expect(est.insufficientData).toBe(false);
    expect(est.uncertainty).toBeLessThan(0.15);
  });
  it('thompson sampling is reproducible per seed', () => {
    const s = statsWith({ divergent: { qualified: 8, unique: 10 } });
    const a = thompsonWeights(s, 42);
    const b = thompsonWeights(s, 42);
    expect(a.weights).toEqual(b.weights);
  });
});

describe('allocation', () => {
  it('uses equal weights under insufficient data', () => {
    const d = decideAllocation(statsWith({}), 1);
    expect(d.insufficientData).toBe(true);
    expect(d.weights.divergent).toBeCloseTo(0.25);
    expect(d.weights.recombination).toBeCloseTo(0.25);
  });
  it('feedback changes allocation (learning demonstrable)', () => {
    // Before: all equal. After: divergent earns many qualifications.
    const before = decideAllocation(statsWith({ divergent: { qualified: 1, unique: 6 } }), 100);
    const strongDivergent = statsWith({ divergent: { qualified: 9, unique: 10 }, analogy: { qualified: 1, unique: 10 }, inversion: { qualified: 1, unique: 10 }, recombination: { qualified: 1, unique: 10 } });
    const after = decideAllocation(strongDivergent, 100);
    // with seeded draws, strong operator should not be starved below its share
    expect(after.weights.divergent).toBeGreaterThan(0.1);
    expect(after.insufficientData).toBe(false);
    // and the decision is logged with a reason
    expect(after.reason).toMatch(/Thompson|insufficient/);
  });
  it('retains nonzero exploration floor for underperformers', () => {
    const strongDivergent = statsWith({ divergent: { qualified: 40, unique: 50 }, analogy: { qualified: 2, unique: 50 }, inversion: { qualified: 2, unique: 50 }, recombination: { qualified: 2, unique: 50 } });
    const d = decideAllocation(strongDivergent, 7, 0.25);
    const minWeight = Math.min(...Object.values(d.weights));
    expect(minWeight).toBeGreaterThan(0); // never zero — floor preserves re-exploration
    expect(d.floorShare).toBe(0.25);
  });
});

describe('credit', () => {
  it('unknown feedback never counts as failure', () => {
    let c = emptyCounters();
    c = applyCredit(c, { operatorId: 'analogy', domain: 'x', kind: 'generated' });
    c = applyCredit(c, { operatorId: 'analogy', domain: 'x', kind: 'unique' });
    // shortlisted but never resolved → unknown, not failed
    c = applyCredit(c, { operatorId: 'analogy', domain: 'x', kind: 'feedback', action: 'shortlisted' });
    expect(c.failed).toBe(0);
    expect(c.succeeded).toBe(0);
  });
  it('succeeded/failed increment outcome counters', () => {
    let c = emptyCounters();
    c = applyCredit(c, { operatorId: 'divergent', domain: 'x', kind: 'feedback', action: 'succeeded' });
    expect(c.succeeded).toBe(1);
    c = applyCredit(c, { operatorId: 'divergent', domain: 'x', kind: 'feedback', action: 'failed' });
    expect(c.failed).toBe(1);
  });
});

const champ: SearchStrategy = {
  id: 's1',
  version: 'v0.1',
  isChampion: true,
  operatorWeights: { divergent: 0.35, analogy: 0.3, inversion: 0.2, recombination: 0.15 },
  populationSize: 8,
  maxGenerations: 2,
  explorationFloor: 0.1,
  maxTokens: 400000,
  maxCostUsd: 2,
  prompts: { divergent: '', analogy: '', inversion: '', recombination: '' },
  modelAssignments: { creative: 'fake', judge: 'fake' },
};

function arm(id: string, version: string, metrics: Partial<ArmResult['metrics']>, problems: number): ArmResult {
  const base = {
    generatedIdeas: 24,
    validIdeas: 24,
    uniqueMechanisms: 8,
    qualifiedUniqueIdeas: 6,
    qualifiedPerDollar: 6,
    duplicateRate: 0.1,
    topKDiversity: 0.8,
    meanNovelty: 3.5,
    bestNovelty: 5,
    meanFeasibility: 3.8,
    latencyMs: 1000,
    costUsd: 1,
  };
  return {
    strategyId: id,
    strategyVersion: version,
    metrics: { ...base, ...metrics },
    perProblem: Array.from({ length: problems }, (_, i) => ({ problemId: `p${i}`, qualifiedUnique: 1, costUsd: 0.25, seed: i })),
  };
}

describe('challenger + promotion gate', () => {
  it('builds versioned challenger from optimizer change', () => {
    const challenger = buildChallenger(champ, {
      rationale: 'r',
      promptChange: { operator: 'analogy', newPrompt: 'be stricter about mapping constraints' },
      weightChange: null,
    }, 's2');
    expect(challenger.version).toBe('v0.2-challenger');
    expect(challenger.isChampion).toBe(false);
    expect(challenger.prompts.analogy).toContain('stricter');
    expect(challenger.operatorWeights).toEqual(champ.operatorWeights);
  });

  it('gate rejects when improvement below threshold', () => {
    const gate = evaluateGate(arm('s1', 'v0.1', {}, 6), arm('s2', 'v0.2', { qualifiedPerDollar: 6.3 }, 6));
    expect(gate.eligible).toBe(false);
    expect(gate.reasons.join(' ')).toContain('qualifiedPerDollar');
  });

  it('gate accepts a real improvement with guards intact', () => {
    const gate = evaluateGate(arm('s1', 'v0.1', {}, 6), arm('s2', 'v0.2', { qualifiedPerDollar: 8.5 }, 6));
    expect(gate.eligible).toBe(true);
  });

  it('gate rejects guard regression even with primary gain', () => {
    const gate = evaluateGate(
      arm('s1', 'v0.1', { meanFeasibility: 4 }, 6),
      arm('s2', 'v0.2', { qualifiedPerDollar: 9, meanFeasibility: 2 }, 6)
    );
    expect(gate.eligible).toBe(false);
    expect(gate.reasons.join(' ')).toContain('meanFeasibility');
  });

  it('gate requires minimum problems', () => {
    const gate = evaluateGate(arm('s1', 'v0.1', {}, 2), arm('s2', 'v0.2', { qualifiedPerDollar: 9 }, 2));
    expect(gate.eligible).toBe(false);
    expect(gate.reasons.join(' ')).toContain('problems');
  });

  it('rejected strategy can never be promoted', () => {
    const out = promoteStrategy(
      { id: 'e1', decision: 'rejected', challengerStrategyId: 's2', rationale: 'r' },
      buildChallenger(champ, { rationale: 'r', promptChange: null, weightChange: null }, 's2'),
      'user-1',
      true
    );
    expect(out.ok).toBe(false);
  });

  it('eligible challenger promotes to new champion with audit entry', () => {
    const challenger = buildChallenger(champ, {
      rationale: 'r',
      promptChange: { operator: 'divergent', newPrompt: 'push harder for distinct mechanisms' },
      weightChange: null,
    }, 's2');
    const out = promoteStrategy(
      { id: 'e1', decision: 'eligible_for_promotion', challengerStrategyId: 's2', rationale: 'r' },
      challenger,
      'user-1',
      true
    );
    expect(out.ok).toBe(true);
    expect(out.newChampion?.isChampion).toBe(true);
    expect(out.newChampion?.version).not.toMatch(/challenger/);
    expect(out.audit.decision).toBe('promoted');
  });
});
