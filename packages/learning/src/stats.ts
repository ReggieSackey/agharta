/**
 * Beta-Bernoulli statistics for operator performance.
 * Separate, clearly-labeled counters for:
 *   - provisional qualification (automated proxy evidence)
 *   - real outcomes (user feedback evidence)
 * `unknown` outcomes NEVER count as failures.
 */
import type { OperatorId } from '@agharta/shared';
import { OPERATOR_IDS } from '@agharta/shared';
import { mulberry32 } from '@agharta/shared';

export interface OperatorCounters {
  generated: number;
  valid: number;
  unique: number;
  provisionallyQualified: number;
  shortlisted: number;
  attempted: number;
  succeeded: number;
  failed: number;
  unknown: number;
}

export function emptyCounters(): OperatorCounters {
  return { generated: 0, valid: 0, unique: 0, provisionallyQualified: 0, shortlisted: 0, attempted: 0, succeeded: 0, failed: 0, unknown: 0 };
}

export type OperatorStatsMap = Record<OperatorId, OperatorCounters>;

export function emptyStatsMap(): OperatorStatsMap {
  return {
    divergent: emptyCounters(),
    analogy: emptyCounters(),
    inversion: emptyCounters(),
    recombination: emptyCounters(),
  };
}

export interface SmoothedEstimate {
  /** posterior mean of Beta(alpha, beta) on qualification probability */
  mean: number;
  /** 0..1 Wilson-style 95% interval half-width (uncertainty label) */
  uncertainty: number;
  sampleSize: number;
  /** honest label when data is too sparse to say anything */
  insufficientData: boolean;
}

/** Beta prior: uniform Beta(1,1) — reproducible, documented. */
export const PRIOR_ALPHA = 1;
export const PRIOR_BETA = 1;

export function smoothQualification(c: OperatorCounters): SmoothedEstimate {
  const alpha = PRIOR_ALPHA + c.provisionallyQualified;
  const beta = PRIOR_BETA + Math.max(0, c.unique - c.provisionallyQualified);
  const mean = alpha / (alpha + beta);
  const z = 1.96;
  const p = c.provisionallyQualified;
  const nn = c.unique;
  const wilson = wilsonHalfWidth(p, nn, z);
  return {
    mean: round4(mean),
    uncertainty: round4(wilson),
    sampleSize: nn,
    insufficientData: nn < 5,
  };
}

export function smoothOutcome(c: OperatorCounters): SmoothedEstimate {
  const decided = c.succeeded + c.failed;
  const alpha = PRIOR_ALPHA + c.succeeded;
  const beta = PRIOR_BETA + c.failed;
  return {
    mean: round4(alpha / (alpha + beta)),
    uncertainty: round4(wilsonHalfWidth(c.succeeded, decided, 1.96)),
    sampleSize: decided,
    insufficientData: decided < 3,
  };
}

export function wilsonHalfWidth(successes: number, n: number, z = 1.96): number {
  if (n === 0) return 0.5;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return margin / denom;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Thompson sampling over qualification posteriors
// ---------------------------------------------------------------------------

/**
 * Sample a Beta draw per operator (seeded, reproducible) and normalize to
 * weights. With `explorationFloor`, reserve a fraction of allocation for the
 * least-exposed operators regardless of draws.
 */
export function thompsonWeights(
  stats: OperatorStatsMap,
  seed: number
): { weights: Record<OperatorId, number>; draws: Record<OperatorId, number>; rngSeed: number } {
  const rng = mulberry32(seed);
  const draws = {} as Record<OperatorId, number>;
  for (const op of OPERATOR_IDS) {
    const c = stats[op];
    const alpha = PRIOR_ALPHA + c.provisionallyQualified;
    const beta = PRIOR_BETA + Math.max(0, c.unique - c.provisionallyQualified);
    draws[op] = sampleBeta(alpha, beta, rng);
  }
  const sum = OPERATOR_IDS.reduce((s, op) => s + draws[op], 0) || 1;
  const weights = {} as Record<OperatorId, number>;
  for (const op of OPERATOR_IDS) weights[op] = round4(draws[op] / sum);
  return { weights, draws, rngSeed: seed };
}

/** Beta sampling via two gamma draws (Marsaglia-Tsang is overkill here). */
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const s = x + y;
  return s === 0 ? 0.5 : x / s;
}

function sampleGamma(shape: number, rng: () => number): number {
  // Gamma(shape) as sum of `floor(shape)` exponentials + fractional part via Ahrens-Dieter approx
  const floorS = Math.floor(shape);
  let sum = 0;
  for (let i = 0; i < floorS; i++) sum += -Math.log(1 - rng() || 1e-12);
  const frac = shape - floorS;
  if (frac > 0) {
    // Ahrens-Dieter for shape < 1
    const u = rng();
    const b = (Math.E + frac) / Math.E;
    if (u <= 1) {
      sum += Math.pow(u * b, 1 / frac);
    } else {
      sum += -Math.log((1 - u) * b / frac + 1e-12);
    }
  }
  return sum;
}
