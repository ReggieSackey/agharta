/**
 * Allocation policy: Thompson sampling weights + exploration floor + assignment
 * logging. Allocation changes ONLY through this module so every change is
 * logged with its reason and seed.
 */
import type { OperatorId } from '@agharta/shared';
import { OPERATOR_IDS } from '@agharta/shared';
import type { OperatorStatsMap } from './stats';
import { thompsonWeights } from './stats';

export interface AllocationDecision {
  weights: Record<OperatorId, number>;
  floorShare: number;
  /** least-exposed operators receiving the reserved floor share */
  floorRecipients: OperatorId[];
  reason: string;
  seed: number;
  insufficientData: boolean;
}

export const DEFAULT_EXPLORATION_FLOOR = 0.1;

export function decideAllocation(
  stats: OperatorStatsMap,
  seed: number,
  explorationFloor: number = DEFAULT_EXPLORATION_FLOOR
): AllocationDecision {
  const totalSamples = OPERATOR_IDS.reduce((s, op) => s + stats[op].unique, 0);
  const insufficient = totalSamples < 20;
  if (insufficient) {
    return {
      weights: { divergent: 0.25, analogy: 0.25, inversion: 0.25, recombination: 0.25 },
      floorShare: explorationFloor,
      floorRecipients: leastExposed(stats),
      reason: `insufficient data (unique=${totalSamples} < 20): equal allocation with exploration floor`,
      seed,
      insufficientData: true,
    };
  }
  const { weights } = thompsonWeights(stats, seed);
  const floorRecipients = leastExposed(stats);
  // apply floor: scale Thompson weights to (1-floor) and distribute floor to recipients
  const adjusted = {} as Record<OperatorId, number>;
  const floorEach = explorationFloor / Math.max(1, floorRecipients.length);
  for (const op of OPERATOR_IDS) {
    const inFloor = floorRecipients.includes(op);
    adjusted[op] = round4(weights[op] * (1 - explorationFloor) + (inFloor ? floorEach : 0));
  }
  const wsum = OPERATOR_IDS.reduce((s, op) => s + adjusted[op], 0) || 1;
  for (const op of OPERATOR_IDS) adjusted[op] = round4(adjusted[op] / wsum);
  return {
    weights: adjusted,
    floorShare: explorationFloor,
    floorRecipients,
    reason: `Thompson sampling (seed ${seed}) with ${(explorationFloor * 100).toFixed(0)}% exploration floor for ${floorRecipients.join(', ')}`,
    seed,
    insufficientData: false,
  };
}

function leastExposed(stats: OperatorStatsMap): OperatorId[] {
  const exposures = OPERATOR_IDS.map((op) => ({ op, n: stats[op].unique }));
  const min = Math.min(...exposures.map((e) => e.n));
  return exposures.filter((e) => e.n === min).map((e) => e.op);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
