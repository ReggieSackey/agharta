/**
 * Benchmark metrics — computed identically for engine and baselines.
 */
import type { Evaluation, Idea, Usage } from '@agharta/shared';
import { cosineSimilarity, hashEmbedding } from '@agharta/shared';

export interface QualifiedThresholds {
  /** proxy >= this counts as provisionally qualified */
  minProxy: number;
  /** feasibility gate */
  minFeasibility: number;
}

export const DEFAULT_THRESHOLDS: QualifiedThresholds = { minProxy: 3.4, minFeasibility: 3 };

export interface MetricInput {
  ideas: Idea[];
  evaluations: Map<string, Evaluation>;
  usage: Usage;
}

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

export function computeMetrics(input: MetricInput, thresholds: QualifiedThresholds = DEFAULT_THRESHOLDS): ExplorationMetrics {
  const { ideas, evaluations, usage } = input;
  const rows = ideas.map((i) => {
    const e = evaluations.get(i.id);
    return {
      idea: i,
      proxy: e ? proxyOf(e) : undefined,
      feasibility: e?.feasibility,
      novelty: e?.originality,
    };
  });
  return computeFromProxies(rows, usage, thresholds);
}

function proxyOf(e: Evaluation): number {
  return e.originality * 0.4 + e.usefulness * 0.4 + e.feasibility * 0.2;
}

export function computeFromProxies(
  rows: Array<{ idea: Idea; proxy?: number; feasibility?: number; novelty?: number }>,
  usage: Usage,
  thresholds: QualifiedThresholds
): ExplorationMetrics {
  const generated = rows.length;
  const uniqueTitles = new Set(rows.map((r) => r.idea.title.trim().toLowerCase()));
  const uniqueRows = rows.filter((r) => r.idea.title.trim().toLowerCase() === [...uniqueTitles][0] || true);
  const unique = dedupRows(rows);
  const mechanisms = new Set(unique.map((r) => mechanismKey(r.idea)));
  const qualified = unique.filter(
    (r) => (r.proxy ?? 0) >= thresholds.minProxy && (r.feasibility ?? 0) >= thresholds.minFeasibility
  );
  const novelties = unique.map((r) => r.novelty ?? 0).sort((a, b) => b - a);
  const top4 = unique.slice(0, 4);
  return {
    generatedIdeas: generated,
    validIdeas: unique.length,
    uniqueMechanisms: mechanisms.size,
    qualifiedUniqueIdeas: qualified.length,
    qualifiedPerDollar: usage.costUsd > 0 ? round4(qualified.length / usage.costUsd) : 0,
    duplicateRate: generated > 0 ? round4((generated - unique.length) / generated) : 0,
    topKDiversity: round4(meanPairwiseSimilarity(top4.map((r) => r.idea)) === 0 ? 1 : 1 - meanPairwiseSimilarity(top4.map((r) => r.idea))),
    meanNovelty: mean(unique.map((r) => r.novelty ?? 0)),
    bestNovelty: novelties[0] ?? 0,
    meanFeasibility: mean(unique.map((r) => r.feasibility ?? 0)),
    latencyMs: usage.wallClockMs,
    costUsd: round4(usage.costUsd),
  };
}

function dedupRows(rows: Array<{ idea: Idea }>): Array<{ idea: Idea; proxy?: number; feasibility?: number; novelty?: number }> {
  const seen = new Set<string>();
  const out: Array<{ idea: Idea; proxy?: number; feasibility?: number; novelty?: number }> = [];
  for (const r of rows) {
    const key = r.idea.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function mechanismKey(idea: Idea): string {
  // normalized causal mechanism key (first 8 content words)
  return idea.causalMechanism
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(' ');
}

function meanPairwiseSimilarity(ideas: Idea[]): number {
  if (ideas.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      sum += cosineSimilarity(hashEmbedding(text(ideas[i]!)), hashEmbedding(text(ideas[j]!)));
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function text(i: Idea): string {
  return `${i.title}\n${i.causalMechanism}`;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : round4(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
