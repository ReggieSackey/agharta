/**
 * Engine 1 (V2) end-to-end with the deterministic fake model:
 *   - produces multiple meaningfully different hypotheses across slots
 *   - records rejected + accepted candidates
 *   - returns 2–3 final proposals with mechanism story
 *   - uses the ACTIVE policy snapshot (records versions used)
 *   - full experiment record persisted shape is valid
 */
import { describe, it, expect } from 'vitest';
import { runExperiment } from './engine2';
import { createFakeModel } from '../models';
import { initialConceptualMap, initialSearchPolicy } from '@agharta/learning';
import { ExperimentRecordSchema } from '@agharta/shared';
import type { ConceptualMap, SearchPolicy } from '@agharta/shared';

const PROBLEM = `I've been trying to find a job for months. I've applied to hundreds of roles, networked, contacted recruiters, and tried conventional strategies. I need something genuinely unconventional.`;

describe('Engine 1 V2 end-to-end (fake model)', () => {
  it('runs the full experimental search cycle', async () => {
    const model = createFakeModel();
    const { record, finalProposals } = await runExperiment(model, {
      experimentId: 'exp_test_1',
      workspaceId: 'ws_test',
      problemId: 'prob_1',
      problemText: PROBLEM,
      domain: 'personal',
      budgetPreset: 'standard',
      map: initialConceptualMap(),
      policy: initialSearchPolicy(),
      seed: 11,
    });

    // Step A: structured interpretation exists
    expect(record.problemStructure.objective.length).toBeGreaterThan(0);
    expect(record.problemStructure.structureTags.length).toBeGreaterThan(0);
    expect(record.problemStructure.conventionalSolutions.length).toBeGreaterThanOrEqual(1);

    // Step B: versions recorded
    expect(record.mapVersionId).toBe('map-v0.1:seed');
    expect(record.policyVersionId).toBe('policy-v0.1:seed');

    // Step C: 6 hypotheses across all three slot types
    expect(record.hypotheses.length).toBe(6);
    const slots = record.hypotheses.map((h) => h.slot);
    expect(slots.filter((s) => s === 'exploitation').length).toBe(3);
    expect(slots.filter((s) => s === 'exploration').length).toBe(2);
    expect(slots.filter((s) => s === 'wildcard').length).toBe(1);
    // distinct mechanisms
    const mechIds = new Set(record.hypotheses.map((h) => h.mechanismId));
    expect(mechIds.size).toBe(6);
    // hypotheses carry the required descriptive fields
    for (const h of record.hypotheses) {
      expect(h.transferRationale.length).toBeGreaterThan(10);
      expect(h.structuralMapping.length).toBeGreaterThanOrEqual(1);
      expect(h.invalidatingAssumptions.length).toBeGreaterThanOrEqual(1);
      expect(h.selectionProbability).toBeGreaterThan(0);
    }

    // Step D: investigation produced candidates; rejected paths preserved
    expect(record.candidates.length).toBeGreaterThanOrEqual(6);
    const stages = new Set(record.candidates.map((c) => c.stage));
    expect(record.hypotheses.filter((h) => h.status === 'rejected' || h.status === 'investigated').length)
      .toBeGreaterThan(0);

    // Step E: novelty assessments for surviving candidates
    expect(record.noveltyAssessments.length).toBeGreaterThan(0);
    for (const a of record.noveltyAssessments) {
      expect(a.vsConventional).toBeGreaterThanOrEqual(1);
      expect(a.vsConventional).toBeLessThanOrEqual(5);
      expect(a.justification.length).toBeGreaterThan(10);
    }

    // Step F: 2-3 final proposals with mechanism story
    expect(finalProposals.length).toBeGreaterThanOrEqual(2);
    expect(finalProposals.length).toBeLessThanOrEqual(3);
    for (const f of finalProposals) {
      expect(f.mechanismField.length).toBeGreaterThan(0);
      expect(f.novelty).toBeGreaterThanOrEqual(1);
    }

    // Step G: record validates against the schema
    expect(ExperimentRecordSchema.safeParse(record).success).toBe(true);

    // honest usage accounting
    expect(record.usage.modelCalls).toBeGreaterThan(5);
    expect(record.status).toBe('completed');
    expect(record.errors).toEqual([]);
  }, 60_000);

  it('records failure state when the model fails at interpretation', async () => {
    const model = createFakeModel();
    const failing: typeof model = {
      ...model,
      generate: async () => {
        throw new Error('provider down');
      },
    };
    const { record } = await runExperiment(failing, {
      experimentId: 'exp_test_2',
      workspaceId: 'ws_test',
      problemId: 'prob_2',
      problemText: PROBLEM,
      domain: 'personal',
      budgetPreset: 'quick',
      map: initialConceptualMap(),
      policy: initialSearchPolicy(),
      seed: 3,
    });
    expect(record.status).toBe('failed');
    expect(record.errors.length).toBeGreaterThan(0);
    expect(record.errors[0]).toContain('interpret failed');
  }, 30_000);
});

