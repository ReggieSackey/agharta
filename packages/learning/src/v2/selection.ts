/**
 * V2 hypothesis selection: which mechanisms does Engine 1 investigate, and in
 * which slot? This is WHERE learning changes behavior:
 *
 *   - exploitation slots pick by Thompson draws over compat(structure, mech,
 *     policy) using LEARNED weights + field posteriors
 *   - exploration slots are forced from uncertain/distant regions (hard floor;
 *     the policy cannot shrink them below explorationFloor)
 *   - 1 wildcard slot challenges the problem framing
 *
 * Selection probabilities are logged for bias correction in Engine 2.
 */
import type { ProblemStructure, Mechanism, SearchPolicy, ConceptualMap } from '@agharta/shared';
import { SEED_STRUCTURE_TAGS } from '@agharta/shared';
import { compat, hashStr } from './compat';

export interface MechanismCandidate {
  mechanism: Mechanism;
  /** posterior mean compatibility from the map edges (0..1) */
  mapCompatibility: number;
  /** evidence count behind mapCompatibility */
  evidenceCount: number;
}

export interface SelectedMechanism {
  mechanism: Mechanism;
  slot: 'exploitation' | 'exploration' | 'wildcard';
  policyScore: number;
  /** normalized selection probability under this policy for this draw */
  selectionProbability: number;
}

/** mulberry32 seeded rng */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Beta draw via two Gamma draws (matches V1 sampler). */
function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const s = x + y;
  return s === 0 ? 0.5 : x / s;
}
function sampleGamma(shape: number, rng: () => number): number {
  const floorS = Math.floor(shape);
  let sum = 0;
  for (let i = 0; i < floorS; i++) sum += -Math.log(1 - rng() || 1e-12);
  const frac = shape - floorS;
  if (frac > 0) {
    const u = rng();
    const b = (Math.E + frac) / Math.E;
    if (u <= 1) sum += Math.pow(u * b, 1 / frac);
    else sum += -Math.log(((1 - u) * b) / frac + 1e-12);
  }
  return sum;
}

/**
 * Score every candidate mechanism under the policy, Thompson-sample the
 * exploitation slots, and force exploration + wildcard slots.
 */
export function selectHypotheses(
  structure: ProblemStructure,
  candidates: MechanismCandidate[],
  policy: SearchPolicy,
  seed: number
): SelectedMechanism[] {
  const rng = rng32(seed);
  const nExploit = policy.slots.exploitation;
  const nExplore = Math.max(
    policy.slots.exploration,
    Math.ceil(policy.explorationFloor * (nExploit + policy.slots.exploration + policy.slots.wildcard))
  );

  // score all candidates
  const scored = candidates.map((c) => {
    const learned = compat(structure, c.mechanism, policy);
    // blend learned compat with map edge posterior mean (evidence-weighted)
    const evidence = c.evidenceCount;
    const blended = (learned * 1 + c.mapCompatibility * Math.min(1, evidence / 5)) /
      (1 + Math.min(1, evidence / 5));
    const fieldPost = policy.fieldPosteriors[c.mechanism.field] ?? { alpha: 1, beta: 1 };
    // uncertainty: how little evidence this (field, mechanism) has
    const uncertainty = 1 / (1 + evidence + fieldPost.alpha + fieldPost.beta - 2);
    return {
      ...c,
      learned,
      blended,
      fieldAlpha: fieldPost.alpha,
      fieldBeta: fieldPost.beta,
      uncertainty,
      distance: conceptualDistance(structure, c.mechanism),
    };
  });

  const chosen: SelectedMechanism[] = [];
  const usedIdx = new Set<number>();

  // --- exploitation: Thompson draws over blended score ---
  const exploitPool = scored.map((s, i) => ({ ...s, i })).filter((s) => !usedIdx.has(s.i));
  const draws = exploitPool.map((s) => ({
    i: s.i,
    // Beta posterior on "productive transfer": prior 1,1 + pseudo-counts from
    // blended score × 10 (soft evidence) + field evidence
    draw: sampleBeta(1 + s.blended * 10 + s.fieldAlpha - 1, 1 + (1 - s.blended) * 10 + s.fieldBeta - 1, rng),
    s,
  }));
  draws.sort((a, b) => b.draw - a.draw);
  const totalDraw = draws.reduce((acc, d) => acc + d.draw, 0) || 1;
  for (const d of draws.slice(0, nExploit)) {
    if (usedIdx.has(d.i)) continue;
    usedIdx.add(d.i);
    chosen.push({
      mechanism: d.s.mechanism,
      slot: 'exploitation',
      policyScore: round4(d.s.blended),
      selectionProbability: round4(Math.max(0.01, d.draw / totalDraw)),
    });
  }

  // --- exploration: prefer uncertain OR conceptually distant, anti-correlated
  // with exploitation picks (novelty objective) ---
  const explorePool = scored
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !usedIdx.has(s.i))
    .sort((a, b) => (b.uncertainty + b.distance) - (a.uncertainty + a.distance));
  // stochastic pick among the top exploration candidates
  for (let k = 0; k < nExplore; k++) {
    const pool = explorePool.filter((s) => !usedIdx.has(s.i));
    if (pool.length === 0) break;
    // pick from the top half by (uncertainty + distance)
    const topHalf = pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
    const pickIdx = topHalf[Math.floor(rng() * topHalf.length)]!.i;
    usedIdx.add(pickIdx);
    const s = scored[pickIdx]!;
    chosen.push({
      mechanism: s.mechanism,
      slot: 'exploration',
      policyScore: round4(s.blended),
      selectionProbability: round4(1 / Math.max(1, topHalf.length)),
    });
  }

  // --- wildcard: most conceptually distant remaining (challenges framing) ---
  const wildPool = scored
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !usedIdx.has(s.i))
    .sort((a, b) => b.distance - a.distance);
  if (wildPool.length > 0) {
    const pick = wildPool[0]!;
    usedIdx.add(pick.i);
    const s = scored[pick.i]!;
    chosen.push({
      mechanism: s.mechanism,
      slot: 'wildcard',
      policyScore: round4(s.blended),
      selectionProbability: round4(1 / wildPool.length),
    });
  }

  return chosen;
}

/**
 * Conceptual distance between a problem and a mechanism's field — hash-based
 * coarse proxy (structure tags rarely literally match field names; distance is
 * deliberately jumpy so "far" transfers are reachable). Higher = farther.
 */
export function conceptualDistance(structure: ProblemStructure, mechanism: Mechanism): number {
  const tagHash = structure.structureTags.reduce((acc, t) => acc + hashStr(t), 0);
  const fieldHash = hashStr(mechanism.field);
  const diff = Math.abs(tagHash % 997 - fieldHash % 997) / 997;
  return round4(0.2 + 0.8 * diff);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
