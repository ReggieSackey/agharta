/**
 * THE definitional test: the full V2 loop.
 *
 *   experiment → observation → learn → gate → promote → next experiment
 *   uses the promoted artifacts and SELECTS DIFFERENTLY.
 *
 * Uses the fake model (deterministic) so the pipeline is exercised without
 * credentials. The learning signal is synthetic (controlled evidence) because
 * the fake model's judge outputs are seeded pseudo-random — the point is to
 * prove the MECHANISM: learned parameters change selection behavior.
 */
import { describe, it, expect } from 'vitest';
import { runExperiment } from '@agharta/core';
import { createFakeModel } from '@agharta/core/models';
import { initialConceptualMap, initialSearchPolicy, learn, selectHypotheses } from '@agharta/learning';
import { extractObservation } from '@agharta/learning';
import type { ExperimentObservation } from '@agharta/shared';
import { SEED_MECHANISMS } from '@agharta/shared';

const PROBLEM_A = 'Unconventional job-search: months of applications, need something genuinely different.';
const PROBLEM_B = 'Our open-source project cannot retain contributors: people open issues then vanish.';

describe('V2 learning loop (definitional)', () => {
  it('learning from experiments changes the next experiment', async () => {
    const model = createFakeModel();
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();

    // --- experiment 1 with seed artifacts ---
    const { record: rec1 } = await runExperiment(model, {
      experimentId: 'exp_1',
      workspaceId: 'ws_loop',
      problemId: 'prob_1',
      problemText: PROBLEM_A,
      domain: 'personal',
      budgetPreset: 'standard',
      map: map0,
      policy: policy0,
      seed: 5,
    });
    expect(rec1.status).toBe('completed');

    // --- observe + learn (synthetic controlled evidence injected on top of
    // the real observation so the signal is strong and deterministic) ---
    const obs1 = extractObservation(rec1)!;
    expect(obs1.hypothesisOutcomes.length).toBe(6);

    // Controlled: make sc_quorum + sc_stigmergy (exploration picks) clear winners
    const enriched: ExperimentObservation[] = [obs1];
    for (let i = 0; i < 10; i++) {
      enriched.push({
        ...obs1,
        experimentId: `synthetic_${i}`,
        hypothesisOutcomes: obs1.hypothesisOutcomes.map((h) => ({
          ...h,
          hypothesisId: `${h.hypothesisId}:s${i}`,
          experimentId: `synthetic_${i}`,
          producedNovelCoherent: ['sc_quorum', 'sc_stigmergy'].includes(h.mechanismId),
          bestNovelty: ['sc_quorum', 'sc_stigmergy'].includes(h.mechanismId) ? 4.5 : 1.5,
        })),
      });
    }

    const { map: map1, policy: policy1 } = learn(map0, policy0, enriched);
    expect(policy1.version).toBe('policy-v0.2');
    expect(map1.version).toBe('map-v0.2');

    // --- the learned artifacts must change SELECTION for this problem ---
    const winners = new Set(['sc_quorum', 'sc_stigmergy']);
    const struct = rec1.problemStructure;
    const pool = SEED_MECHANISMS.map((m) => ({ mechanism: m, mapCompatibility: 0.5, evidenceCount: 0 }));
    let winnerHits0 = 0, winnerHits1 = 0;
    for (let seed = 0; seed < 40; seed++) {
      const s0 = selectHypotheses(struct, pool, policy0, seed);
      const s1 = selectHypotheses(struct, pool, policy1, seed);
      if (s0.some((s) => winners.has(s.mechanism.id))) winnerHits0++;
      if (s1.some((s) => winners.has(s.mechanism.id))) winnerHits1++;
    }
    expect(winnerHits1).toBeGreaterThan(winnerHits0);
    expect(winnerHits1).toBeGreaterThanOrEqual(3);

    // --- experiment 2 uses promoted artifacts → verify snapshot + behavior ---
    const { record: rec2 } = await runExperiment(model, {
      experimentId: 'exp_2',
      workspaceId: 'ws_loop',
      problemId: 'prob_2',
      problemText: PROBLEM_B,
      domain: 'product',
      budgetPreset: 'standard',
      map: map1,
      policy: policy1,
      seed: 5,
    });
    // records which versions it used
    expect(rec2.policyVersionId).toBe('policy-v0.2:42');
    expect(rec2.mapVersionId).toBe('map-v0.2:42');

    // the two experiments on different problems selected different mechanisms
    const mechs1 = new Set(rec1.hypotheses.map((h) => h.mechanismId));
    const mechs2 = new Set(rec2.hypotheses.map((h) => h.mechanismId));
    const overlap = [...mechs1].filter((m) => mechs2.has(m)).length;
    // different problems → different structures → different selections expected
    expect(overlap).toBeLessThan(6);
  }, 120_000);

  it('learning from failed transfers reduces their future selection', async () => {
    const model = createFakeModel();
    const map0 = initialConceptualMap();
    const policy0 = initialSearchPolicy();

    const { record: rec } = await runExperiment(model, {
      experimentId: 'exp_f',
      workspaceId: 'ws_loop',
      problemId: 'prob_f',
      problemText: 'Startup needs non-obvious growth channels beyond paid ads.',
      domain: 'business',
      budgetPreset: 'standard',
      map: map0,
      policy: initialSearchPolicy(),
      seed: 21,
    });
    expect(rec.status).toBe('completed');
    const obs = extractObservation(rec)!;

    // Controlled: everything FAILED except nothing — all transfers failed
    const failures: ExperimentObservation[] = [];
    for (let i = 0; i < 10; i++) {
      failures.push({
        ...obs,
        experimentId: `fail_${i}`,
        hypothesisOutcomes: obs.hypothesisOutcomes.map((h) => ({
          ...h,
          hypothesisId: `${h.hypothesisId}:f${i}`,
          experimentId: `fail_${i}`,
          producedNovelCoherent: false,
          bestNovelty: 1.2,
        })),
      });
    }
    const { policy: policyFail } = learn(map0, policy0, failures);

    // compat for previously-picked mechanisms should drop below 0.5
    const struct = obs.problemStructure;
    const pool = SEED_MECHANISMS.map((m) => ({ mechanism: m, mapCompatibility: 0.5, evidenceCount: 0 }));
    let before = 0, after = 0;
    for (let seed = 0; seed < 30; seed++) {
      const s0 = selectHypotheses(struct, pool, policy0, seed);
      const s1 = selectHypotheses(struct, pool, policyFail, seed);
      before += s0.filter((s) => s.slot === 'exploitation').length;
      after += s1.filter((s) => (s.slot === 'exploitation')).length;
    }
    // exploitation still runs (3 slots) but the PICKS changed: mechanisms that
    // failed are drawn less often — check their policy scores dropped
    const picked0 = new Map<string, number>();
    for (let seed = 0; seed < 30; seed++) {
      for (const s of selectHypotheses(struct, pool, policy0, seed)) picked0.set(s.mechanism.id, s.policyScore);
    }
    let dropped = 0;
    for (const [mid, score0] of picked0) {
      const s1 = selectHypotheses(struct, pool, policyFail, 30).find((s) => s.mechanism.id === mid);
      if (!s1 || s1.policyScore < score0) dropped++;
    }
    expect(dropped).toBeGreaterThan(picked0.size / 2);
    expect(policyFail.explorationFloor).toBe(0.25); // floor untouched by failures
  }, 120_000);
});

