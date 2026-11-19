'use node';
/**
 * Challenger experiment runner: runs champion and challenger strategies on
 * the same fixed benchmark problems with matched budgets and multiple seeds,
 * applies the promotion gate, records the experiment. No autonomous
 * promotion — user confirmation required via strategies.promote.
 */
import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { runExploration } from '@agharta/core';
import type { EngineRuntime, EngineConfig } from '@agharta/core';
import { ModelJudge, engineJudgeAdapter, computeMetrics, DEFAULT_THRESHOLDS } from '@agharta/evaluation';
import { evaluateGate, DEFAULT_PROMOTION_GATE, buildChallenger } from '@agharta/learning';
import type { SearchStrategy, Usage, Idea, Evaluation } from '@agharta/shared';
import { budgetFor } from '@agharta/shared';
import { VALIDATION_PROBLEMS } from '@agharta/benchmarks';
import type { ProblemContext } from '@agharta/core';
import type { ModelAdapter } from '@agharta/core';

export const runExperiment = internalAction({
  args: { experimentId: v.id('optimizationExperiments'), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.internal.optimizePersist.loadExperiment, { experimentId: args.experimentId });
    const { experiment, champion, challenger } = loaded as {
      experiment: { workspaceId: Id<'workspaces'>; seeds: number[] };
      champion: { config: SearchStrategy };
      challenger: { config: SearchStrategy };
    };

    const { adaptersFromEnv } = await import('@agharta/core/models.providers');
    const { creative } = await adaptersFromEnv({
      AI_PROVIDER: process.env.AI_PROVIDER,
      CREATIVE_PROVIDER: process.env.CREATIVE_PROVIDER,
      JUDGE_PROVIDER: process.env.JUDGE_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      GLM_API_KEY: process.env.GLM_API_KEY,
      CREATIVE_MODEL_ID: process.env.CREATIVE_MODEL_ID,
      JUDGE_MODEL_ID: process.env.JUDGE_MODEL_ID,
      MODEL_BASE_URL: process.env.MODEL_BASE_URL,
    });
    const judge = new ModelJudge(creative);

    // fixed validation subset (explicitly non-holdout; holdout is never tuned on)
    const validationProblems = VALIDATION_PROBLEMS;
    const seeds = experiment.seeds.length ? experiment.seeds : [11, 22, 33];
    const budget = budgetFor('quick');

    const runArm = async (strategy: SearchStrategy, armLabel: string) => {
      const ideas: Idea[] = [];
      const evals = new Map<string, Evaluation>();
      const usageAcc: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, modelCalls: 0, wallClockMs: 0 };
      const perProblem: Array<{ problemId: string; qualifiedUnique: number; costUsd: number; seed: number }> = [];
      for (const bp of validationProblems) {
        for (const seed of seeds) {
          const mem = memoryRuntime();
          const cfg: EngineConfig = {
            explorationId: `bench:${armLabel}:${bp.id}:${seed}`,
            problem: bp.toProblemContext(),
            strategy,
            budget,
            seed,
            judge: engineJudgeAdapter(judge),
            creativeModel: creative,
          };
          const result = await runExploration(cfg, mem.runtime);
          for (const i of mem.ideas) ideas.push(i);
          for (const e of mem.evaluations) evals.set(e.ideaId, e);
          usageAcc.inputTokens += result.usage.inputTokens;
          usageAcc.outputTokens += result.usage.outputTokens;
          usageAcc.costUsd += result.usage.costUsd;
          usageAcc.modelCalls += result.usage.modelCalls;
          usageAcc.wallClockMs += result.usage.wallClockMs;
        }
        const armIdeas = ideas.filter((i) => i.explorationId.includes(`:${bp.id}:`));
        const metrics = computeMetrics({ ideas: armIdeas, evaluations: evals, usage: usageAcc }, DEFAULT_THRESHOLDS);
        perProblem.push({
          problemId: bp.id,
          qualifiedUnique: metrics.qualifiedUniqueIdeas,
          costUsd: metrics.costUsd,
          seed: seeds[0]!,
        });
      }
      const metrics = computeMetrics({ ideas, evaluations: evals, usage: usageAcc }, DEFAULT_THRESHOLDS);
      return { strategyId: armLabel, strategyVersion: strategy.version, metrics, perProblem };
    };

    const championArm = await runArm(champion.config, 'champion');
    const challengerArm = await runArm(challenger.config, 'challenger');

    // Zero-cost providers (fake/local) make qualifiedPerDollar identically 0,
    // so the default primary is unmeasurable. Fall back to the absolute
    // qualified-unique count and label the substitution explicitly — never
    // silently swap metrics.
    const zeroCost = championArm.metrics.costUsd === 0 && challengerArm.metrics.costUsd === 0;
    const gate = evaluateGate(
      championArm,
      challengerArm,
      zeroCost ? { ...DEFAULT_PROMOTION_GATE, primary: 'qualifiedUniqueIdeas' } : DEFAULT_PROMOTION_GATE
    );
    const primaryUsed = zeroCost ? 'qualifiedUniqueIdeas' : DEFAULT_PROMOTION_GATE.primary;
    const basis = zeroCost ? ' (fallback: zero-cost provider makes qualifiedPerDollar unmeasurable)' : '';

    await ctx.runMutation(internal.internal.optimizePersist.writeExperimentResult, {
      experimentId: args.experimentId,
      championResult: championArm,
      challengerResult: challengerArm,
      decision: gate.eligible ? 'eligible_for_promotion' : 'rejected',
      rationale: gate.eligible
        ? `challenger improved ${primaryUsed} by ${(gate.primaryDelta * 100).toFixed(1)}% across ${validationProblems.length} problems × ${seeds.length} seeds${basis}`
        : `rejected: ${gate.reasons.join('; ')}${basis}`,
    });
    return { eligible: gate.eligible, reasons: gate.reasons };
  },
});

/** Minimal in-memory runtime for benchmark arms (no persistence by design). */
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
