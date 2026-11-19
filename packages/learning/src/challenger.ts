/**
 * Challenger experiments: propose a strategy delta, run champion vs challenger
 * on the SAME fixed validation problems with matched budgets and multiple
 * seeds, compute comparative metrics, and apply the promotion gate.
 * Promotion always requires explicit user confirmation (MVP rule).
 */
import type { OperatorId, SearchStrategy } from '@agharta/shared';
import { z } from 'zod';
import type { ExplorationMetrics } from '@agharta/evaluation';

// ---------------------------------------------------------------------------
// Optimizer: propose one structured change to the champion
// ---------------------------------------------------------------------------

export const OptimizerOutputSchema = z.object({
  rationale: z.string().min(1).max(2000),
  promptChange: z
    .object({ operator: z.enum(['divergent', 'analogy', 'inversion', 'recombination']), newPrompt: z.string().min(1).max(8000) })
    .nullable(),
  weightChange: z
    .object({ operator: z.enum(['divergent', 'analogy', 'inversion', 'recombination']), newWeight: z.number().min(0).max(1) })
    .nullable(),
});
export type OptimizerOutput = z.infer<typeof OptimizerOutputSchema>;

/**
 * Deterministic fallback proposal when no structured proposal is supplied:
 * tilt allocation toward analogy (the broadest cross-domain operator) while
 * keeping prompts unchanged. Small, reviewable, and always a real change.
 */
export function fallbackProposal(): OptimizerOutput {
  return {
    rationale:
      'Fallback optimizer tweak: raise analogy weight to shift generation toward cross-domain transfer, the operator class with the widest source library coverage; all other knobs unchanged.',
    promptChange: null,
    weightChange: { operator: 'analogy', newWeight: 0.45 },
  };
}

/** Build a challenger from champion + proposed change (pure, versioned). */
export function buildChallenger(champion: SearchStrategy, change: OptimizerOutput, id: string): SearchStrategy {
  const challenger: SearchStrategy = structuredClone(champion);
  challenger.id = id;
  challenger.isChampion = false;
  const [maj, min] = champion.version.replace(/^v/, '').split('.').map((x) => parseInt(x, 10));
  challenger.version = `v${maj}.${(min ?? 0) + 1}-challenger`;
  if (change.promptChange) {
    challenger.prompts = { ...challenger.prompts, [change.promptChange.operator]: change.promptChange.newPrompt };
  }
  if (change.weightChange) {
    challenger.operatorWeights = { ...challenger.operatorWeights, [change.weightChange.operator]: change.weightChange.newWeight };
    // renormalize weights to sum to 1
    const sum = Object.values(challenger.operatorWeights).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(challenger.operatorWeights) as OperatorId[]) {
      challenger.operatorWeights[k] = Math.round((challenger.operatorWeights[k] / sum) * 1e4) / 1e4;
    }
  }
  return challenger;
}

// ---------------------------------------------------------------------------
// Experiment record
// ---------------------------------------------------------------------------

export interface ArmResult {
  strategyId: string;
  strategyVersion: string;
  metrics: ExplorationMetrics;
  /** per-problem metric rows for transparency */
  perProblem: Array<{ problemId: string; qualifiedUnique: number; costUsd: number; seed: number }>;
}

export interface ExperimentRecord {
  id: string;
  workspaceId: string;
  championStrategyId: string;
  challengerStrategyId: string;
  /** benchmark snapshot id + problem set version for reproducibility */
  benchmarkVersion: string;
  seeds: number[];
  champion: ArmResult;
  challenger: ArmResult;
  decision: 'pending_user_promotion' | 'eligible_for_promotion' | 'rejected';
  rationale: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Promotion gate — predeclared criteria, no silent autonomy
// ---------------------------------------------------------------------------

export interface PromotionGate {
  /** challenger must beat champion by this fraction on primary metric */
  minImprovementFraction: number;
  /** primary metric */
  primary: 'qualifiedPerDollar' | 'qualifiedUniqueIdeas' | 'topKDiversity';
  /** must not regress on these by more than maxRegression */
  guards: Array<{ metric: keyof ExplorationMetrics; maxRegressionFraction: number }>;
  /** minimum problems per arm */
  minProblems: number;
}

export const DEFAULT_PROMOTION_GATE: PromotionGate = {
  minImprovementFraction: 0.1,
  primary: 'qualifiedPerDollar',
  guards: [
    { metric: 'meanFeasibility', maxRegressionFraction: 0.1 },
    { metric: 'topKDiversity', maxRegressionFraction: 0.05 },
  ],
  minProblems: 4,
};

export interface GateEvaluation {
  eligible: boolean;
  reasons: string[];
  primaryDelta: number;
}

export function evaluateGate(
  champion: ArmResult,
  challenger: ArmResult,
  gate: PromotionGate = DEFAULT_PROMOTION_GATE
): GateEvaluation {
  const reasons: string[] = [];
  if (challenger.perProblem.length < gate.minProblems) {
    reasons.push(`challenger ran ${challenger.perProblem.length} problems < required ${gate.minProblems}`);
  }
  const c = champion.metrics;
  const k = challenger.metrics;
  const base = c[gate.primary];
  const primaryDelta = base === 0 ? (k[gate.primary] > 0 ? Infinity : 0) : (k[gate.primary] - base) / Math.abs(base);
  if (!(primaryDelta >= gate.minImprovementFraction)) {
    reasons.push(
      `primary ${gate.primary}: ${(primaryDelta * 100).toFixed(1)}% delta < ${(gate.minImprovementFraction * 100).toFixed(0)}% required`
    );
  }
  for (const g of gate.guards) {
    const cv = c[g.metric];
    const kv = k[g.metric];
    const regression = cv === 0 ? (kv < 0 ? Infinity : 0) : (cv - kv) / Math.abs(cv);
    if (regression > g.maxRegressionFraction) {
      reasons.push(`guard ${String(g.metric)} regressed ${(regression * 100).toFixed(1)}% > ${(g.maxRegressionFraction * 100).toFixed(0)}%`);
    }
  }
  return { eligible: reasons.length === 0, reasons, primaryDelta: primaryDelta === Infinity ? Infinity : round4(primaryDelta) };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
