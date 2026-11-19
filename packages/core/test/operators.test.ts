import { describe, expect, it } from 'vitest';
import { createFakeModel, runOperator, OPERATORS, selectSources } from '../src';
import type { OperatorRunContext } from '../src';
import { SOURCE_CONCEPTS } from '../src';

const problem = {
  title: 'Reduce checkout abandonment',
  description: 'Cart abandonment at 71% on mobile; users drop at shipping step.',
  desiredOutcome: 'Abandonment below 50% within a quarter.',
  constraints: ['must not increase fraud losses', 'PCI compliance required'],
  domain: 'product',
  previouslyTried: ['one-page checkout redesign'],
};

function ctx(overrides: Partial<OperatorRunContext> = {}): OperatorRunContext {
  return { problem, parents: [], seed: 42, ...overrides };
}

describe('operators', () => {
  it('divergent produces structured OperatorOutput records', async () => {
    const res = await runOperator(OPERATORS.divergent!, ctx(), createFakeModel(), 3, 't1');
    expect(res.outputs.length).toBeGreaterThanOrEqual(1);
    for (const o of res.outputs) {
      expect(o.title.length).toBeGreaterThan(3);
      expect(o.causalMechanism.length).toBeGreaterThan(10);
      expect(o.assumptions.length).toBeGreaterThanOrEqual(1);
      expect(o.failureModes.length).toBeGreaterThanOrEqual(1);
      expect(o.proposedTest.length).toBeGreaterThan(10);
    }
  });

  it('analogy offers curated sources and preserves provenance', async () => {
    const res = await runOperator(OPERATORS.analogy!, ctx(), createFakeModel(), 3, 't2');
    expect(res.offeredSourceIds.length).toBeGreaterThanOrEqual(2);
    const offered = res.offeredSourceIds.map((id) => SOURCE_CONCEPTS.find((c) => c.id === id)!);
    for (const c of offered) expect(c.verified).toBe(true);
  });

  it('inversion records what was inverted and repair survival', async () => {
    const res = await runOperator(OPERATORS.inversion!, ctx(), createFakeModel(), 3, 't3');
    const inversions = res.outputs.filter((o) => o.invertedConstraint !== undefined);
    expect(inversions.length).toBeGreaterThan(0);
    for (const o of inversions) expect(typeof o.survivedRepair).toBe('boolean');
  });

  it('recombination records both parents', async () => {
    const parents = [
      { id: 'p1', title: 'Cache tiering for quotes', causalMechanism: 'frequency-based cost splitting', intervention: 'x', operatorId: 'divergent' as const },
      { id: 'p2', title: 'WIP limits on approvals', causalMechanism: 'scarcity forcing surfacing', intervention: 'y', operatorId: 'inversion' as const },
    ];
    const res = await runOperator(OPERATORS.recombination!, ctx({ parents }), createFakeModel(), 2, 't4');
    expect(res.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it('source selection is deterministic per seed and strata-sampled', () => {
    const a = selectSources(problem, 42);
    const b = selectSources(problem, 42);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    const c = selectSources(problem, 43);
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
  });

  it('rejects analogy outputs citing unknown sources', async () => {
    const bad = createFakeModel();
    // hijack: model that cites a nonexistent source
    const evil = {
      ...bad,
      generate: async () => ({
        data: { ideas: [{ title: 'x', intervention: 'y', causalMechanism: 'z', assumptions: ['a'], failureModes: ['f'], proposedTest: 't', sourceConceptIds: ['sc_nonexistent'] }] },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, modelCalls: 1, wallClockMs: 1 },
        modelId: 'evil',
      }),
    };
    await expect(runOperator(OPERATORS.analogy!, ctx(), evil as never, 1, 't5')).rejects.toThrow(/unknown source concept/);
  });
});
