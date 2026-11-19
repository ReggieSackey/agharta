'use node';
/**
 * Durable exploration execution (internal action).
 * - Called via scheduler from explorations.start
 * - Persists progress via internal mutations (actions can't touch ctx.db)
 * - Idempotent: checks status before running; never double-finalizes
 * - Cancellation-aware; aborts cleanly and keeps partial results
 */
import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { runExploration } from '@agharta/core';
import type { EngineRuntime, EngineConfig } from '@agharta/core';
import { ModelJudge, engineJudgeAdapter } from '@agharta/evaluation';
import type { Budget, Evaluation, Idea, OperatorId, SearchStrategy, Usage } from '@agharta/shared';
import { budgetFor } from '@agharta/shared';
import type { ProblemContext } from '@agharta/core';

// ---------------------------------------------------------------------------
// Internal queries/mutations used by the action (trusted server-only bridge)
// ---------------------------------------------------------------------------

/** Load everything the engine needs. Trusted: internal only. */
export const runExplorationAction = internalAction({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    // idempotency guard: skip if already running/completed
    const loaded = await ctx.runQuery(internal.internal.persist.loadExplorationContext, {
      explorationId: args.explorationId,
    });
    const { ex, problem, strategy } = loaded as {
      ex: { _id: Id<'explorations'>; workspaceId: Id<'workspaces'>; status: string; budget: Budget; seed: number };
      problem: { title: string; description: string; desiredOutcome: string; domain: string; constraints: string[]; previousAttempts: string[] } | null;
      strategy: { config: SearchStrategy } | null;
    };
    if (!problem) throw new Error('problem missing');
    if (ex.status !== 'queued') {
      return { skipped: true, reason: `status=${ex.status}` };
    }

    const problemCtx: ProblemContext = {
      title: problem.title,
      description: problem.description,
      desiredOutcome: problem.desiredOutcome,
      constraints: problem.constraints ?? [],
      domain: problem.domain,
      previouslyTried: problem.previousAttempts ?? [],
    };

    // model adapters: fake (deterministic) unless a real provider is configured;
    // provider-agnostic — openai / anthropic / deepseek / glm / openai-compatible
    const { adaptersFromEnv } = await import('@agharta/core/models.providers');
    const env = {
      AI_PROVIDER: process.env.AI_PROVIDER,
      CREATIVE_PROVIDER: process.env.CREATIVE_PROVIDER,
      JUDGE_PROVIDER: process.env.JUDGE_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      GLM_API_KEY: process.env.GLM_API_KEY ?? process.env.ZHIPU_API_KEY ?? process.env.ZAI_API_KEY,
      CREATIVE_API_KEY: process.env.CREATIVE_API_KEY,
      JUDGE_API_KEY: process.env.JUDGE_API_KEY,
      CREATIVE_MODEL_ID: process.env.CREATIVE_MODEL_ID,
      JUDGE_MODEL_ID: process.env.JUDGE_MODEL_ID,
      MODEL_BASE_URL: process.env.MODEL_BASE_URL,
      CREATIVE_BASE_URL: process.env.CREATIVE_BASE_URL,
      JUDGE_BASE_URL: process.env.JUDGE_BASE_URL,
      MODEL_COST_INPUT: process.env.MODEL_COST_INPUT,
      MODEL_COST_OUTPUT: process.env.MODEL_COST_OUTPUT,
    };
    const runtime: EngineRuntime = {
      persistIdea: async (idea, evaluation) =>
        ctx.runMutation(internal.internal.persist.persistIdeaInternal, {
          explorationId: args.explorationId,
          workspaceId: ex.workspaceId,
          idea,
          evaluation,
        }),
      persistEdge: async (parentId, childId, relation) => {
        await ctx.runMutation(internal.internal.persist.persistEdgeInternal, {
          workspaceId: ex.workspaceId,
          parentId,
          childId,
          relation,
        });
      },
      persistIdeaSource: async (ideaId, slug, distance, notes) => {
        await ctx.runMutation(internal.internal.persist.persistIdeaSourceInternal, {
          workspaceId: ex.workspaceId,
          ideaId: ideaId as Id<'ideas'>,
          slug,
          distance,
          notes,
        });
      },
      recordInvocation: async (operator, usage, meta) => {
        await ctx.runMutation(internal.internal.persist.recordInvocationInternal, {
          workspaceId: ex.workspaceId,
          explorationId: args.explorationId,
          operator,
          usage,
          meta,
        });
      },
      persistEvaluation: async (evaluation) => {
        await ctx.runMutation(internal.internal.persist.persistEvaluationInternal, {
          workspaceId: ex.workspaceId,
          evaluation,
        });
      },
      reportProgress: async (progress, stage) => {
        await ctx.runMutation(internal.internal.persist.reportProgressInternal, {
          explorationId: args.explorationId,
          progress,
          stage,
        });
      },
      log: async (event) => {
        if (event.type === 'stage' || event.type === 'log') {
          // errors persisted separately; this is a no-op for info logs to keep rows small
        }
      },
      shouldCancel: async () => {
        const state = await ctx.runQuery(internal.internal.persist.loadExplorationStatus, {
          explorationId: args.explorationId,
        });
        return state === 'cancelled';
      },
    };

    // Build adapters INSIDE the guarded section so misconfiguration (unknown
    // provider, missing API key, missing baseURL) finalizes the exploration as
    // `failed` with a clear error instead of throwing out of the action and
    // leaving the record stuck in `queued` forever.
    let creative: Awaited<ReturnType<typeof adaptersFromEnv>>['creative'];
    let judge: ModelJudge;
    try {
      const { creative: c, judge: j } = await adaptersFromEnv(env);
      creative = c;
      judge = new ModelJudge(j);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.internal.persist.appendErrorInternal, {
        explorationId: args.explorationId,
        message: `provider configuration error: ${message}`,
      });
      await ctx.runMutation(internal.internal.persist.finalizeExplorationInternal, {
        explorationId: args.explorationId,
        status: 'failed',
        usage: null,
        summary: null,
        recommendations: [],
        mechanisms: [],
      });
      throw err;
    }

    try {
      const cfg: EngineConfig = {
        explorationId: args.explorationId,
        problem: problemCtx,
        // prefer the exact config snapshotted at start time (champion × learned
        // weights) so run provenance is stable even if strategy docs change later
        strategy: (ex as { effectiveStrategy?: unknown }).effectiveStrategy as SearchStrategy | undefined ?? strategy?.config ?? defaultStrategyFallback(),
        budget: Budget_parse(ex.budget),
        seed: ex.seed,
        judge: engineJudgeAdapter(judge),
        creativeModel: creative,
      };
      const result = await runExploration(cfg, runtime);
      await ctx.runMutation(internal.internal.persist.finalizeExplorationInternal, {
        explorationId: args.explorationId,
        status: result.status,
        usage: result.usage,
        summary: { recommendations: result.recommendations },
        recommendations: result.recommendations,
        mechanisms: result.mechanisms,
      });
      return { ok: true, ideas: result.selectedIdeas.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.internal.persist.appendErrorInternal, {
        explorationId: args.explorationId,
        message,
      });
      await ctx.runMutation(internal.internal.persist.finalizeExplorationInternal, {
        explorationId: args.explorationId,
        status: 'failed',
        usage: null,
        summary: null,
        recommendations: [],
        mechanisms: [],
      });
      throw err;
    }
  },
});

function defaultStrategyFallback(): SearchStrategy {
  // local import avoided (engine pure module exports defaultChampion via index)
  // inline a minimal champion to keep this file self-contained in Convex bundling
  return {
    id: 'fallback',
    version: 'v0.1',
    isChampion: true,
    operatorWeights: { divergent: 0.35, analogy: 0.3, inversion: 0.2, recombination: 0.15 },
    populationSize: 8,
    maxGenerations: 2,
    explorationFloor: 0.1,
    maxTokens: 400000,
    maxCostUsd: 2,
    prompts: { divergent: '', analogy: '', inversion: '', recombination: '' },
    modelAssignments: { creative: 'fake', judge: 'fake' },
  };
}

function Budget_parse(b: unknown): Budget {
  return b as Budget;
}
