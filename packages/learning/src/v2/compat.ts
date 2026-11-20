/**
 * V2 Engine 2 — learned compatibility model.
 *
 * compat(problemStructure, mechanism, policy) -> 0..1 probability that this
 * mechanism transfers productively to this problem shape.
 *
 * Concrete algorithm: L2-regularized logistic regression over hashed joint
 * features (structureTag × mechanismField, structureTag × appliesWhen-bucket,
 * distance bucket). Chosen because:
 *   - works from zero data (bias-only prior ≈ uniform)
 *   - generalizes across problems via shared tag×field features
 *   - interpretable weights (per tag-field pair)
 *   - cheap to fit online (SGD with ridge) inside a Convex action
 *   - replaceable behind this interface
 *
 * The hashed-feature logistic model IS the "at least some parameters must be
 * learned" requirement — its weights are fit from experiment evidence and
 * directly change hypothesis selection.
 */
import type { ProblemStructure, Mechanism, SearchPolicy } from '@agharta/shared';

/** Deterministic string hash (FNV-1a 32-bit). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Feature name for a tag×field pair. */
export function tagFieldFeature(tag: string, field: string): string {
  return `tf:${tag}|${field.toLowerCase().trim()}`;
}

/** Feature for a mechanism's appliesWhen bucket. */
export function appliesFeature(tag: string, mechanism: Mechanism): string {
  // bucket the appliesWhen text so similar conditions collide
  const b = hashStr(mechanism.appliesWhen.toLowerCase().slice(0, 120)) % 8;
  return `ap:${tag}|${b}`;
}

/** All joint features for a (structure, mechanism) pair. */
export function jointFeatures(structure: ProblemStructure, mechanism: Mechanism): string[] {
  const feats: string[] = [];
  for (const tag of structure.structureTags) {
    feats.push(tagFieldFeature(tag, mechanism.field));
    feats.push(appliesFeature(tag, mechanism));
  }
  return feats;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Learned compatibility score (0..1) under a policy. */
export function compat(
  structure: ProblemStructure,
  mechanism: Mechanism,
  policy: SearchPolicy
): number {
  let z = policy.compatBias;
  for (const f of jointFeatures(structure, mechanism)) {
    z += (policy.compatWeights[f] ?? 0) * featureWeightScale(f);
  }
  return sigmoid(z);
}

function featureWeightScale(_f: string): number {
  return 1; // features are binary; weights carry the magnitude
}

/**
 * Fit compatWeights by regularized logistic SGD over hypothesis outcomes.
 * X = joint features of (problemStructure, mechanism); y = producedNovelCoherent.
 * Returns new weights (does not mutate the policy).
 */
export interface FitExample {
  structure: ProblemStructure;
  mechanism: Mechanism;
  outcome: boolean;
  /** importance weight (e.g. inverse selection probability for bias correction) */
  weight?: number;
}

export interface FitOptions {
  learningRate?: number;
  epochs?: number;
  l2?: number;
  seed?: number;
}

export function fitCompatWeights(
  examples: FitExample[],
  base: SearchPolicy,
  opts: FitOptions = {}
): { weights: Record<string, number>; bias: number; examplesUsed: number } {
  const lr = opts.learningRate ?? 0.15;
  const epochs = opts.epochs ?? 8;
  const l2 = opts.l2 ?? 0.01;
  const weights: Record<string, number> = { ...base.compatWeights };
  let bias = base.compatBias;
  if (examples.length === 0) return { weights, bias, examplesUsed: 0 };

  // seeded shuffle for deterministic fitting
  const rng = mulberry32(opts.seed ?? 42);
  const order = examples.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const idx of order) {
      const ex = examples[idx]!;
      const feats = jointFeatures(ex.structure, ex.mechanism);
      let z = bias;
      for (const f of feats) z += weights[f] ?? 0;
      const p = sigmoid(z);
      const w = ex.weight ?? 1;
      const grad = (p - (ex.outcome ? 1 : 0)) * w;
      bias -= lr * grad;
      for (const f of feats) {
        const cur = weights[f] ?? 0;
        weights[f] = cur - lr * (grad + l2 * cur);
      }
    }
  }
  return { weights, bias, examplesUsed: examples.length };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
