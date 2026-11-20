/**
 * V2 learning-engine tests — the definitional claims:
 *   1. Synthetic controlled evidence changes learned compatibility estimates.
 *   2. Updated policy changes subsequent hypothesis-selection probabilities.
 *   3. Exploration floor survives any learning.
 *   4. Promotion gate blocks weak challengers, passes strong ones.
 *   5. Learning is deterministic (idempotent double-runs).
 */
import { describe, it, expect } from 'vitest';
import {
  learn, initialConceptualMap, initialSearchPolicy, evaluatePromotionGate,
} from '../index';
import { compat, fitCompatWeights, tagFieldFeature } from './compat';
import { selectHypotheses } from './selection';
import type { ExperimentObservation, ProblemStructure, SearchPolicy } from '@agharta/shared';
import { SEED_MECHANISMS } from '@agharta/shared';

function structure(tags: string[]): ProblemStructure {
  return {
    objective: 'test objective',
    structureTags: tags,
    actors: [], incentives: [], constraints: [], resources: [], obstacles: [],
    conventionalSolutions: ['conventional answer'],
    previouslyTried: [], uncertainties: [],
    interpretationConfidence: 4,
  };
}

function observation(
  expId: string,
  mechId: string,
  tags: string[],
  success: boolean,
  opts: { selProb?: number } = {}
): ExperimentObservation {
  const mech = SEED_MECHANISMS.find((m) => m.id === mechId)!;
  return {
    experimentId: expId,
    workspaceId: 'ws_test',
    problemStructure: structure(tags),
    domain: 'other',
    hypothesisOutcomes: [
      {
        hypothesisId: `${expId}:h1`,
        experimentId: expId,
        mechanismId: mechId,
        mechanismField: mech.field,
        structureTags: tags,
        slot: 'exploitation',
        producedNovelCoherent: success,
        bestNovelty: success ? 4.2 : 2.1,
        duplicateOutcomes: 0,
        incoherentOutcomes: success ? 0 : 1,
        candidateCount: 2,
        humanShortlisted: 0,
        humanRejected: 0,
        policyScore: 0.6,
        selectionProbability: opts.selProb ?? 0.3,
      },
    ],
    feedbackActions: [],
    observedAt: 1,
  };
}

describe('V2 learning', () => {
  it('1. synthetic evidence changes learned compatibility estimates', () => {
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();
    const tag = 'bottleneck';
    const mechId = 'sc_wip_limits'; // manufacturing/WIP — bottleneck-adjacent
    const before = compat(structure([tag]), SEED_MECHANISMS.find((m) => m.id === mechId)!, policy0);

    // 12 successes for wip_limits on bottleneck problems
    const obs = Array.from({ length: 12 }, (_, i) => observation(`e${i}`, mechId, [tag], true));
    const { map, policy } = learn(map0, policy0, obs);

    const edge = map.edges.find((e) => e.from === `tag:${tag}` && e.to === mechId);
    expect(edge).toBeDefined();
    expect(edge!.alpha).toBeGreaterThan(5); // evidence accumulated
    expect(edge!.compatibility).toBeGreaterThan(0.5); // learned positive

    const after = compat(structure([tag]), SEED_MECHANISMS.find((m) => m.id === mechId)!, policy);
    expect(after).toBeGreaterThan(before); // logistic weights moved
    expect(after).toBeGreaterThan(0.5);
  });

  it('2. updated policy changes subsequent hypothesis selection', () => {
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();
    const struct = structure(['search', 'signaling']);

    // Build candidate pool of all mechanisms
    const pool = SEED_MECHANISMS.map((m) => ({ mechanism: m, mapCompatibility: 0.5, evidenceCount: 0 }));

    // Baseline selection with seed policy (seed 7)
    const selBefore = selectHypotheses(struct, pool, policy0, 7);

    // Learn: sc_broken_windows succeeds on 'signaling' problems repeatedly
    const obs = Array.from({ length: 12 }, (_, i) =>
      observation(`e${i}`, 'sc_broken_windows', ['search', 'signaling'], true));
    const { policy: policy1 } = learn(map0, policy0, obs);

    // After learning, compat for broken_windows on signaling problems rose
    const c0 = compat(struct, SEED_MECHANISMS.find((m) => m.id === 'sc_broken_windows')!, policy0);
    const c1 = compat(struct, SEED_MECHANISMS.find((m) => m.id === 'sc_broken_windows')!, policy1);
    expect(c1).toBeGreaterThan(c0);

    // And the mechanism now wins an exploitation slot more often across seeds
    let hitsBefore = 0, hitsAfter = 0;
    for (let seed = 0; seed < 40; seed++) {
      const a = selectHypotheses(struct, pool, policy0, seed);
      const b = selectHypotheses(struct, pool, policy1, seed);
      if (a.some((s) => s.mechanism.id === 'sc_broken_windows')) hitsBefore++;
      if (b.some((s) => s.mechanism.id === 'sc_broken_windows')) hitsAfter++;
    }
    // With 40 seeds the learned preference must be visible in selection
    expect(hitsAfter).toBeGreaterThan(hitsBefore);
    expect(hitsAfter).toBeGreaterThan(4); // meaningfully above chance for a 37-mech pool
  });

  it('3. exploration floor is hard — learning cannot remove exploration slots', () => {
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();
    // even with heavy evidence that near transfers succeed...
    const obs = Array.from({ length: 30 }, (_, i) =>
      observation(`e${i}`, 'sc_immune', ['search'], true, { selProb: 0.9 }));
    const { policy } = learn(map0, policy0, obs);
    expect(policy.explorationFloor).toBeGreaterThanOrEqual(0.25);
    expect(policy.slots.exploration).toBeGreaterThanOrEqual(2);

    // selection still includes exploration + wildcard slots
    const pool = SEED_MECHANISMS.map((m) => ({ mechanism: m, mapCompatibility: 0.5, evidenceCount: 0 }));
    const sel = selectHypotheses(structure(['search']), pool, policy, 3);
    expect(sel.filter((s) => s.slot === 'exploration').length).toBeGreaterThanOrEqual(2);
    expect(sel.filter((s) => s.slot === 'wildcard').length).toBe(1);
    expect(sel.filter((s) => s.slot === 'exploitation').length).toBe(3);
  });

  it('4a. promotion gate blocks weak challengers', () => {
    const r = evaluatePromotionGate({
      problemIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      championNovelty: [3.5, 3.6, 3.4, 3.5, 3.7, 3.5],
      challengerNovelty: [3.5, 3.5, 3.5, 3.5, 3.6, 3.5], // marginal
      championCoherence: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      challengerCoherence: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
    });
    expect(r.passed).toBe(false);
    expect(r.challengerBetterProb).toBeLessThan(0.95);
  });

  it('4b. promotion gate passes strong challengers', () => {
    const r = evaluatePromotionGate({
      problemIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      championNovelty: [3.5, 3.6, 3.4, 3.5, 3.7, 3.5],
      challengerNovelty: [4.5, 4.6, 4.4, 4.5, 4.7, 4.5], // clear lift
      championCoherence: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      challengerCoherence: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
    });
    expect(r.passed).toBe(true);
    expect(r.challengerBetterProb).toBeGreaterThanOrEqual(0.95);
  });

  it('4c. gate demands minimum problem count', () => {
    const r = evaluatePromotionGate({
      problemIds: ['p1', 'p2'],
      championNovelty: [3.5, 3.6],
      challengerNovelty: [4.5, 4.6],
      championCoherence: [0.8, 0.8],
      challengerCoherence: [0.8, 0.8],
    });
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toContain('validation problems');
  });

  it('5. learning is deterministic — double run identical', () => {
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();
    const obs = [observation('e1', 'sc_toc_elevation', ['bottleneck'], true),
                 observation('e2', 'sc_toc_elevation', ['bottleneck'], false)];
    const r1 = learn(map0, policy0, obs, SEED_MECHANISMS, 99);
    const r2 = learn(map0, policy0, obs, SEED_MECHANISMS, 99);
    expect(r1.policy.compatWeights).toEqual(r2.policy.compatWeights);
    expect(r1.map.edges).toEqual(r2.map.edges);
  });

  it('6. inverse selection probability weighting counters selection bias', () => {
    // hypothesis selected with p=0.05 but succeeded: weight up to 4
    const rare = fitCompatWeights(
      [{ structure: structure(['trust']), mechanism: SEED_MECHANISMS[0]!, outcome: true, weight: 4 }],
      initialSearchPolicy(),
      { epochs: 30 }
    );
    const none = fitCompatWeights(
      [{ structure: structure(['trust']), mechanism: SEED_MECHANISMS[0]!, outcome: true, weight: 1 }],
      initialSearchPolicy(),
      { epochs: 30 }
    );
    const f = tagFieldFeature('trust', SEED_MECHANISMS[0]!.field);
    expect(rare.weights[f]).toBeGreaterThan(none.weights[f]);
  });
});
