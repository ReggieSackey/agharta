export * from './contracts';
export * from './validators';

// V2 experimental creative search contracts
export * from './v2';
export * from './mechanisms';

// Shared with @agharta/evaluation (single definition; breaks a package cycle)
export interface ExplorationMetrics {
  generatedIdeas: number;
  validIdeas: number;
  uniqueMechanisms: number;
  qualifiedUniqueIdeas: number;
  qualifiedPerDollar: number;
  duplicateRate: number;
  topKDiversity: number;
  meanNovelty: number;
  bestNovelty: number;
  meanFeasibility: number;
  latencyMs: number;
  costUsd: number;
}
