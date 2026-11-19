/**
 * Strategy snapshotting and challenger construction.
 */
import type { OperatorId, SearchStrategy } from '@agharta/shared';
import { OPERATOR_IDS } from '@agharta/shared';

/** v0.1 champion baseline — the starting strategy every workspace inherits. */
export function defaultChampion(id: string): SearchStrategy {
  return {
    id,
    version: 'v0.1',
    isChampion: true,
    operatorWeights: { divergent: 0.35, analogy: 0.3, inversion: 0.2, recombination: 0.15 },
    populationSize: 8,
    maxGenerations: 2,
    explorationFloor: 0.1,
    maxTokens: 400_000,
    maxCostUsd: 2,
    prompts: {
      divergent: '',
      analogy: '',
      inversion: '',
      recombination: '',
    },
    modelAssignments: { creative: 'fake', judge: 'fake' },
  };
}

/** Compute the number of generation opportunities per operator for a run. */
export function allocateOpportunities(
  weights: Record<OperatorId, number>,
  totalSlots: number,
  explorationFloor: number
): Record<OperatorId, number> {
  // reserve floor share for underexplored operators (handled by learning layer)
  const out = { divergent: 0, analogy: 0, inversion: 0, recombination: 0 } as Record<OperatorId, number>;
  const wSum = OPERATOR_IDS.reduce((s, op) => s + (weights[op] ?? 0), 0) || 1;
  for (const op of OPERATOR_IDS) {
    out[op] = Math.floor((totalSlots * (weights[op] ?? 0)) / wSum);
  }
  // distribute remainder to largest weight to make counts add up
  let assigned = OPERATOR_IDS.reduce((s, op) => s + out[op], 0);
  while (assigned < totalSlots) {
    const biggest = OPERATOR_IDS.reduce((a, b) => ((weights[a] ?? 0) >= (weights[b] ?? 0) ? a : b));
    out[biggest] += 1;
    assigned += 1;
  }
  return out;
}
