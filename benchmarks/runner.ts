/**
 * Reproducible benchmark runner.
 * Modes: single-prompt baseline, repeated-sampling baseline, full engine.
 * Uses the deterministic fake model by default (no credentials needed);
 * set AI_PROVIDER=openai + OPENAI_API_KEY for real-model runs.
 * Results are printed as JSON + markdown to benchmarks/results/.
 */
import { runExploration, createFakeModel, defaultChampion } from '@agharta/core';
import type { EngineRuntime, EngineConfig } from '@agharta/core';
import { ModelJudge, engineJudgeAdapter, computeMetrics, DEFAULT_THRESHOLDS } from '@agharta/evaluation';
import type { ExplorationMetrics } from '@agharta/evaluation';
import type { Evaluation, Idea, Usage } from '@agharta/shared';
import { budgetFor, EMPTY_USAGE, addUsage } from '@agharta/shared';
import { BENCHMARK_PROBLEMS, BENCHMARK_VERSION } from './problems';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Mode = 'single_prompt' | 'repeated_sampling' | 'full_engine';

const SEEDS = [11, 22, 33];

function memoryRuntime() {
  const ideas: Idea[] = [];
  const evaluations: Evaluation[] = [];
  const runtime: EngineRuntime = {
    async persistIdea(idea) {
      ideas.push(idea);
      return idea.id;
    },
    async persistEdge() {},
    async persistIdeaSource() {},
    async recordInvocation() {},
    async persistEvaluation(e) {
      evaluations.push(e);
    },
    async reportProgress() {},
    async log() {},
    async shouldCancel() {
      return false;
    },
  };
  return { runtime, ideas, evaluations };
}

/** Baseline: one strong prompt, n ideas, no operators/selection. */
async function runSinglePromptBaseline(problemId: string, seed: number, n: number) {
  const { OPERATORS } = await import('@agharta/core');
  const model = createFakeModel();
  const judge = new ModelJudge(model);
  const problem = BENCHMARK_PROBLEMS.find((p) => p.id === problemId)!;
  const ctx = problem.toProblemContext();
  const result = await (await import('@agharta/core')).runOperator(
    OPERATORS.divergent,
    { problem: ctx, parents: [], seed },
    model,
    n,
    `baseline:${problemId}:${seed}`
  );
  const usage = result.usage;
  const ideas: Idea[] = result.outputs.map((o, i) => ({
    id: `bl_${problemId}_${seed}_${i}`,
    explorationId: `baseline:${problemId}`,
    title: o.title,
    intervention: o.intervention,
    causalMechanism: o.causalMechanism,
    assumptions: o.assumptions,
    failureModes: o.failureModes,
    proposedTest: o.proposedTest,
    operatorId: 'divergent' as const,
    parentIds: [],
    sourceConceptIds: [],
    generation: 0,
  }));
  const evaluations = new Map<string, Evaluation>();
  for (const idea of ideas) {
    const { evaluation } = await judge.evaluate(idea, ideas);
    evaluations.set(idea.id, evaluation);
  }
  return { ideas, evaluations, usage: addUsage(usage, usageFromMap(evaluations)) };
}

function usageFromMap(evaluations: Map<string, Evaluation>): Usage {
  return { ...EMPTY_USAGE, modelCalls: evaluations.size };
}

async function runFullEngine(problemId: string, seed: number) {
  const mem = memoryRuntime();
  const model = createFakeModel();
  const judge = new ModelJudge(model);
  const problem = BENCHMARK_PROBLEMS.find((p) => p.id === problemId)!;
  const cfg: EngineConfig = {
    explorationId: `bench:${problemId}:${seed}`,
    problem: problem.toProblemContext(),
    strategy: defaultChampion('bench-champion'),
    budget: budgetFor('standard'),
    seed,
    judge: engineJudgeAdapter(judge),
    creativeModel: model,
  };
  const result = await runExploration(cfg, mem.runtime);
  const evaluations = new Map(mem.evaluations.map((e) => [e.ideaId, e]));
  return { ideas: mem.ideas, evaluations, usage: result.usage };
}

async function main() {
  const modeArg = (process.argv[2] ?? 'all') as Mode | 'all';
  const modes: Mode[] = modeArg === 'all' ? ['single_prompt', 'repeated_sampling', 'full_engine'] : [modeArg];
  const nonHoldout = BENCHMARK_PROBLEMS.filter((p) => !p.holdout);
  const report: Record<string, unknown> = {
    benchmarkVersion: BENCHMARK_VERSION,
    model: 'fake-deterministic-v1',
    seeds: SEEDS,
    generatedAt: new Date().toISOString(),
    modes: {} as Record<string, Array<{ problemId: string; domain: string; metrics: ExplorationMetrics }>>,
  };

  for (const mode of modes) {
    const rows: Array<{ problemId: string; domain: string; metrics: ExplorationMetrics }> = [];
    for (const problem of nonHoldout) {
      for (const seed of SEEDS) {
        let ideas: Idea[];
        let evaluations: Map<string, Evaluation>;
        let usage: Usage;
        if (mode === 'full_engine') {
          const r = await runFullEngine(problem.id, seed);
          ideas = r.ideas;
          evaluations = r.evaluations;
          usage = r.usage;
        } else {
          const n = mode === 'single_prompt' ? 6 : 24;
          const r = await runSinglePromptBaseline(problem.id, seed, n);
          ideas = r.ideas;
          evaluations = r.evaluations;
          usage = r.usage;
        }
        const metrics = computeMetrics({ ideas, evaluations, usage }, DEFAULT_THRESHOLDS);
        rows.push({ problemId: problem.id, domain: problem.domain, metrics });
      }
    }
    (report.modes as Record<string, unknown[]>)[mode] = rows;
  }

  // aggregate per mode
  const summary: Record<string, Record<string, number>> = {};
  for (const [mode, rows] of Object.entries(report.modes as Record<string, Array<{ metrics: ExplorationMetrics }>>)) {
    const agg = aggregate(rows.map((r) => r.metrics));
    summary[mode] = agg;
  }
  report.summary = summary;

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `benchmark-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${jsonPath}`);
  console.log('\n=== Aggregate (fake model, non-holdout problems) ===');
  for (const [mode, agg] of Object.entries(summary)) {
    console.log(`\n${mode}:`);
    for (const [k, v] of Object.entries(agg)) console.log(`  ${k}: ${v}`);
  }
}

function aggregate(metrics: ExplorationMetrics[]): Record<string, number> {
  const mean = (f: (m: ExplorationMetrics) => number) =>
    metrics.length === 0 ? 0 : Math.round((metrics.reduce((s, m) => s + f(m), 0) / metrics.length) * 1e4) / 1e4;
  return {
    runs: metrics.length,
    meanGenerated: mean((m) => m.generatedIdeas),
    meanUniqueMechanisms: mean((m) => m.uniqueMechanisms),
    meanQualifiedUnique: mean((m) => m.qualifiedUniqueIdeas),
    meanTopKDiversity: mean((m) => m.topKDiversity),
    meanNovelty: mean((m) => m.meanNovelty),
    meanFeasibility: mean((m) => m.meanFeasibility),
    meanDuplicateRate: mean((m) => m.duplicateRate),
    totalCostUsd: Math.round(metrics.reduce((s, m) => s + m.costUsd, 0) * 1e4) / 1e4,
  };
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});
