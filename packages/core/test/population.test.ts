import { describe, expect, it } from 'vitest';
import { selectDiverse, dedupe, DEFAULT_SELECT_OPTIONS } from '../src/population';
import type { Candidate } from '../src/population';
import type { Evaluation, Idea } from '@agharta/shared';

/** Realistic, genuinely-distinct idea fixtures (no templated near-clones). */
const DISTINCT_IDEAS: Array<Partial<Idea>> = [
  {
    title: 'Staleness-aware load shedding',
    intervention: 'Drop requests older than a threshold when saturation is detected at the edge',
    causalMechanism: 'Stale responses carry lower marginal utility, so shedding them first preserves fresh throughput under overload',
  },
  {
    title: 'Adaptive batching by arrival correlation',
    intervention: 'Group incoming work by correlation of arrival times rather than fixed windows',
    causalMechanism: 'Correlated arrivals indicate shared upstream causes, so batching them amortizes setup cost without adding latency to uncorrelated work',
  },
  {
    title: 'Dual-price prioritization queue',
    intervention: 'Let submitters declare urgency with a budget and schedule by blended priority score',
    causalMechanism: 'Self-selection reveals private urgency information, enabling allocative efficiency that uniform scheduling cannot reach',
  },
  {
    title: 'Shadow replica warm pool',
    intervention: 'Keep idle warm capacity sized to predicted spike volumes from history',
    causalMechanism: 'Pre-provisioned capacity converts cold-start latency into carrying cost, trading money for responsiveness during bursts',
  },
  {
    title: 'Constraint elevator pass-through',
    intervention: 'Move validation of rare constraints to a secondary async lane',
    causalMechanism: 'Separating rare checks from the hot path shortens the critical path for the common case while preserving correctness asynchronously',
  },
  {
    title: 'Degradation ladder protocol',
    intervention: 'Define ordered feature tiers and step down progressively as load rises',
    causalMechanism: 'Explicit graceful degradation bounds worst-case experience instead of uniform collapse under stress',
  },
  {
    title: 'Cross-region request affinity pinning',
    intervention: 'Pin user sessions to regions by latency observations rather than geography',
    causalMechanism: 'Latency-based affinity outperforms geographic routing when backbone topology diverges from user location',
  },
  {
    title: 'Backpressure token budget',
    intervention: 'Give each upstream producer a token budget consumed per request, refilled by downstream capacity signals',
    causalMechanism: 'Explicit capacity-proportional credits make overload visible at the source, self-regulating flow without central throttling',
  },
];

function idea(i: number, overrides: Partial<Idea> = {}): Idea {
  const base = DISTINCT_IDEAS[i % DISTINCT_IDEAS.length]!;
  return {
    id: `idea_${i}`,
    explorationId: 'ex',
    title: base.title ?? `Idea ${i}`,
    intervention: base.intervention ?? `intervention ${i}`,
    causalMechanism: base.causalMechanism ?? `mechanism ${i}`,
    assumptions: [`assumption ${i}`],
    failureModes: [`failure ${i}`],
    proposedTest: `test ${i}`,
    operatorId: 'divergent',
    parentIds: [],
    sourceConceptIds: [],
    generation: 0,
    ...overrides,
  };
}

function evaluation(over: Partial<Evaluation> = {}): Evaluation {
  return {
    ideaId: 'x',
    evaluator: 'model-judge',
    evaluatorVersion: 'v',
    originality: 3,
    usefulness: 3,
    feasibility: 3,
    uncertainty: 0.3,
    justification: 'j',
    evidenceKind: 'automated_proxy',
    ...over,
  };
}

describe('dedupe', () => {
  it('removes exact duplicates', () => {
    const c1: Candidate = { idea: idea(1), evaluation: evaluation() };
    const c2: Candidate = { idea: idea(1), evaluation: evaluation() };
    const { unique, duplicates } = dedupe([c1, c2], 0.9);
    expect(unique.length).toBe(1);
    expect(duplicates.length).toBe(1);
  });
  it('keeps genuinely different ideas', () => {
    const a: Candidate = { idea: idea(1), evaluation: evaluation() };
    const b: Candidate = { idea: idea(2), evaluation: evaluation() };
    const { unique } = dedupe([a, b], DEFAULT_SELECT_OPTIONS.duplicateThreshold);
    expect(unique.length).toBe(2);
  });
});

describe('selectDiverse', () => {
  it('reduces near-duplicates in favor of distinct mechanisms', () => {
    const candidates: Candidate[] = [];
    // 8 near-identical high scorers (same text, numbered clones)
    for (let i = 0; i < 8; i++) {
      candidates.push({
        idea: idea(0, {
          id: `clone_${i}`,
          title: `Same idea clone ${i}`,
          causalMechanism: 'identical mechanism: shift work from node 1 to node 2 changes throughput',
          intervention: 'identical intervention with trivial variation ' + i,
        }),
        evaluation: evaluation({ originality: 5, usefulness: 5, feasibility: 4 }),
      });
    }
    // 4 distinct medium scorers
    for (let i = 1; i <= 4; i++) {
      candidates.push({ idea: idea(i, { id: `distinct_${i}` }), evaluation: evaluation() });
    }
    const out = selectDiverse(candidates, { ...DEFAULT_SELECT_OPTIONS, target: 5 });
    expect(out.selected.length).toBeLessThanOrEqual(5);
    const titles = out.selected.map((c) => c.idea.title);
    expect(new Set(titles).size).toBe(titles.length);
    // distinct ideas must survive: clones collapse to 1, so distinct count is >= 2
    const distinctCount = out.selected.filter((c) => c.idea.id.startsWith('distinct_')).length;
    expect(distinctCount).toBeGreaterThanOrEqual(2);
  });

  it('preserves an intentionally unusual viable lineage', () => {
    const candidates: Candidate[] = [];
    for (let i = 0; i < 5; i++) {
      candidates.push({ idea: idea(i, { id: `norm_${i}` }), evaluation: evaluation({ originality: 2, usefulness: 5, feasibility: 5 }) });
    }
    candidates.push({
      idea: idea(7, {
        id: 'weird',
        title: 'Weird lineage: deliberate slack absorption',
        causalMechanism: 'introduce idle buffers on purpose so variance is absorbed instead of amplified',
        intervention: 'deliberately underutilize capacity during predictable demand valleys',
      }),
      evaluation: evaluation({ originality: 5, usefulness: 2, feasibility: 3 }),
    });
    const out = selectDiverse(candidates, { ...DEFAULT_SELECT_OPTIONS, target: 4 });
    expect(out.selected.some((c) => c.idea.id === 'weird')).toBe(true);
  });

  it('rejects infeasible candidates with reason', () => {
    const candidates: Candidate[] = [
      { idea: idea(1), evaluation: evaluation({ feasibility: 1 }) },
      { idea: idea(2), evaluation: evaluation({ feasibility: 4 }) },
    ];
    const out = selectDiverse(candidates, DEFAULT_SELECT_OPTIONS);
    expect(out.rejected.some((r) => r.reason.includes('feasibility'))).toBe(true);
  });
});
