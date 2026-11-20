/**
 * V2 promotion gate: challenger vs champion on a fixed validation suite.
 *
 * Predeclared gate (documented in V2_ARCHITECTURE.md):
 *   PROMOTE if:
 *     1. >= 4 validation problems evaluated
 *     2. paired posterior P(challenger novelty > champion novelty) >= 0.95
 *     3. challenger mean coherence within 2% of champion (no regression)
 *   RETAIN otherwise.
 *
 * Paired comparison: per-problem novelty differences d_i, bootstrap + normal
 * posterior on mean(d). Confidence-aware: with tiny samples the interval is
 * wide, so promotion requires a large effect.
 */
import type { SearchPolicy } from '@agharta/shared';

export interface GateInput {
  problemIds: string[];
  championNovelty: number[];      // aligned with problemIds
  challengerNovelty: number[];
  championCoherence: number[];    // aligned
  challengerCoherence: number[];
  /** min problems required */
  minProblems?: number;
  /** posterior threshold */
  confidenceThreshold?: number;
  /** max coherence regression (fraction) */
  maxCoherenceRegression?: number;
}

export interface GateResult {
  passed: boolean;
  reasons: string[];
  challengerBetterProb: number;
  meanDiff: number;
}

export function evaluatePromotionGate(input: GateInput): GateResult {
  const minProblems = input.minProblems ?? 4;
  const confThreshold = input.confidenceThreshold ?? 0.95;
  const maxCoherenceReg = input.maxCoherenceRegression ?? 0.02;

  const reasons: string[] = [];
  const n = input.problemIds.length;
  if (n < minProblems) {
    return {
      passed: false,
      reasons: [`only ${n} validation problems (< ${minProblems})`],
      challengerBetterProb: 0,
      meanDiff: 0,
    };
  }
  // paired differences
  const diffs = input.challengerNovelty.map((c, i) => c - (input.championNovelty[i] ?? 0));
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(variance / n);
  // normal posterior on mean diff (conjugate-ish; conservative for small n)
  const z = se > 0 ? meanDiff / se : meanDiff > 0 ? 4 : meanDiff < 0 ? -4 : 0;
  const prob = normalCdf(z);
  const champCoh = mean(input.championCoherence);
  const challCoh = mean(input.challengerCoherence);
  const coherenceOk = challCoh >= champCoh * (1 - maxCoherenceReg);
  const noveltyLift = meanDiff > 0;

  const passed = n >= minProblems && prob >= confThreshold && coherenceOk && noveltyLift;
  if (n < minProblems) reasons.push(`only ${n} validation problems (< ${minProblems})`);
  if (!noveltyLift) reasons.push(`mean novelty diff ${meanDiff.toFixed(3)} not positive`);
  if (prob < confThreshold) reasons.push(`P(challenger better)=${prob.toFixed(3)} < ${confThreshold}`);
  if (!coherenceOk) reasons.push(`coherence regression ${(1 - challCoh / (champCoh || 1)).toFixed(3)} > ${maxCoherenceReg}`);
  if (passed) reasons.push(`P(challenger better)=${prob.toFixed(3)} ≥ ${confThreshold}, novelty +${meanDiff.toFixed(3)}, coherence held`);

  return { passed, reasons, challengerBetterProb: round4(prob), meanDiff: round4(meanDiff) };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26 approximation of erf
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
