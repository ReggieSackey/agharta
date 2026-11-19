import { describe, expect, it } from 'vitest';
import { ModelJudge, engineJudgeAdapter, computeMetrics, DEFAULT_THRESHOLDS, runDeterministicChecks, JUDGE_VERSION, rubricPrompt } from '../src';
import { createFakeModel } from '@agharta/core';
import type { Evaluation, Idea, Usage } from '@agharta/shared';
import { EMPTY_USAGE } from '@agharta/shared';

function idea(i: number): Idea {
  return {
    id: `idea_${i}`,
    explorationId: 'ex',
    title: `Idea ${i}: shift work across the boundary ${i}`,
    intervention: `intervention ${i}`,
    causalMechanism: `mechanism ${i}: resequencing steps changes throughput characteristics`,
    assumptions: ['a'],
    failureModes: ['f'],
    proposedTest: 't',
    operatorId: 'divergent',
    parentIds: [],
    sourceConceptIds: [],
    generation: 0,
  };
}

describe('ModelJudge', () => {
  it('produces rubric-shaped evaluations with version stamp', async () => {
    const judge = new ModelJudge(createFakeModel());
    const res = await judge.evaluate(idea(1), [idea(1), idea(2)]);
    expect(res.evaluation.originality).toBeGreaterThanOrEqual(1);
    expect(res.evaluation.originality).toBeLessThanOrEqual(5);
    expect(res.evaluation.evidenceKind).toBe('automated_proxy');
    expect(res.evaluation.evaluatorVersion).toContain(JUDGE_VERSION);
  });
  it('flags deterministic near-duplicates and caps originality', async () => {
    const judge = new ModelJudge(createFakeModel());
    const a = idea(1);
    const b = { ...idea(1), id: 'idea_99', title: a.title + '!' };
    const res = await judge.evaluate(b, [a, b]);
    expect(res.evaluation.justification).toContain('near-duplicate');
  });
});

describe('metrics', () => {
  it('computes qualified/unique/diversity from evaluations', () => {
    const ideas = [idea(1), idea(2), idea(3), idea(3)];
    const evals = new Map<string, Evaluation>();
    for (const i of [1, 2, 3]) {
      evals.set(`idea_${i}`, {
        ideaId: `idea_${i}`,
        evaluator: 'j',
        evaluatorVersion: 'v',
        originality: 4,
        usefulness: 4,
        feasibility: 4,
        uncertainty: 0.2,
        justification: 'x',
        evidenceKind: 'automated_proxy',
      });
    }
    const usage: Usage = { inputTokens: 1000, outputTokens: 2000, costUsd: 0.5, modelCalls: 8, wallClockMs: 500 };
    const m = computeMetrics({ ideas, evaluations: evals, usage }, DEFAULT_THRESHOLDS);
    expect(m.generatedIdeas).toBe(4);
    expect(m.validIdeas).toBe(3);
    expect(m.qualifiedUniqueIdeas).toBe(3); // proxy 4.0 ≥ 3.4 and feasibility 4 ≥ 3
    expect(m.qualifiedPerDollar).toBeCloseTo(6);
    expect(m.duplicateRate).toBeCloseTo(0.25);
  });
});

describe('deterministic checks', () => {
  it('validates schema, lineage, budget', () => {
    const i = idea(1);
    const checks = runDeterministicChecks(i, new Set([i.id]), EMPTY_USAGE, 1);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.passed]));
    expect(byName['schema']).toBe(true);
    expect(byName['lineage']).toBe(true);
    expect(byName['budget']).toBe(true);
    const badLineage = runDeterministicChecks({ ...i, parentIds: ['ghost'] }, new Set(), EMPTY_USAGE, 1);
    expect(badLineage.find((c) => c.name === 'lineage')?.passed).toBe(false);
  });
});

describe('rubrics', () => {
  it('exposes anchored descriptions for every dimension', () => {
    const p = rubricPrompt();
    expect(p).toContain('ORIGINALITY');
    expect(p).toContain('STRUCTURAL VALIDITY');
    expect(p).toContain('paradigm-shifting');
  });
});
