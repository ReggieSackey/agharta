import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_PROBLEMS,
  BENCHMARK_VERSION,
  HOLDOUT_PROBLEMS,
  VALIDATION_PROBLEMS,
} from './index';
import { DOMAINS } from '@agharta/shared';

/**
 * Integrity of the fixed benchmark suite. These problems are the ground the
 * challenger/promotion gate stands on, so their shape is enforced by tests:
 * any edit that silently shrinks coverage, duplicates an id, or leaks holdout
 * problems into the validation set fails here.
 */
describe('benchmark problem suite (bench-v1)', () => {
  it('has at least 12 problems', () => {
    expect(BENCHMARK_PROBLEMS.length).toBeGreaterThanOrEqual(12);
  });

  it('covers at least 5 distinct valid domains with >= 2 problems each', () => {
    const byDomain = new Map<string, number>();
    for (const p of BENCHMARK_PROBLEMS) {
      byDomain.set(p.domain, (byDomain.get(p.domain) ?? 0) + 1);
    }
    expect(byDomain.size).toBeGreaterThanOrEqual(5);
    for (const [domain, count] of byDomain) {
      expect(count, `domain ${domain}`).toBeGreaterThanOrEqual(2);
    }
    for (const domain of byDomain.keys()) {
      expect(DOMAINS).toContain(domain);
    }
  });

  it('every problem is fully specified (outcome, constraints, known approaches)', () => {
    for (const p of BENCHMARK_PROBLEMS) {
      expect(p.id.trim().length, p.id).toBeGreaterThan(0);
      expect(p.title.trim().length, p.id).toBeGreaterThan(8);
      expect(p.brief.trim().length, p.id).toBeGreaterThan(20);
      expect(p.desiredOutcome.trim().length, p.id).toBeGreaterThan(5);
      expect(p.constraints.length, p.id).toBeGreaterThanOrEqual(1);
      expect(p.knownCommonApproaches.length, p.id).toBeGreaterThanOrEqual(1);
      for (const c of p.constraints) expect(c.trim().length, p.id).toBeGreaterThan(3);
    }
  });

  it('has unique problem ids', () => {
    const ids = BENCHMARK_PROBLEMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a holdout set disjoint from the validation set', () => {
    expect(HOLDOUT_PROBLEMS.length).toBeGreaterThanOrEqual(3);
    const validationIds = new Set(VALIDATION_PROBLEMS.map((p) => p.id));
    for (const h of HOLDOUT_PROBLEMS) {
      expect(validationIds.has(h.id), `${h.id} must not be in validation`).toBe(false);
    }
    // Validation set is fixed and non-trivial so challenger runs are comparable.
    expect(VALIDATION_PROBLEMS.length).toBe(4);
  });

  it('exports a version tag', () => {
    expect(BENCHMARK_VERSION).toMatch(/^bench-v\d+$/);
  });

  it('converts to engine ProblemContext with known approaches as previouslyTried', () => {
    for (const p of BENCHMARK_PROBLEMS) {
      const ctx = p.toProblemContext();
      expect(ctx.title).toBe(p.title);
      expect(ctx.previouslyTried).toEqual(p.knownCommonApproaches);
      expect(ctx.constraints).toEqual(p.constraints);
    }
  });
});
