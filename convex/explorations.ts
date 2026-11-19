/**
 * Explorations: start (atomic enqueue), get, list, cancel.
 * Long work runs in internal actions scheduled here — never in the mutation.
 */
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireProblemAccess, requireExplorationAccess, requireWorkspaceMembership } from './auth';
import { BudgetSchema, budgetFor } from '@agharta/shared';
import { defaultChampion } from '@agharta/core';
import type { SearchStrategy } from '@agharta/shared';

/**
 * Merge learned operator weights (from the latest allocationDecision) into a
 * champion strategy config so feedback actually changes subsequent runs. The
 * exploration floor embedded in the strategy is always preserved — learned
 * weights can shrink an operator's share but the engine reserves floor slots
 * for underexplored operators regardless.
 */
function withLearnedWeights(champion: SearchStrategy, learned?: Record<string, number>): SearchStrategy {
  if (!learned) return champion;
  const entries = Object.entries(learned).filter(([, w]) => typeof w === 'number' && w >= 0);
  if (entries.length < 2) return champion;
  const weights = { ...champion.operatorWeights };
  for (const [op, w] of entries) {
    if (op in weights) weights[op as keyof typeof weights] = w;
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) return champion;
  const normalized = {} as typeof weights;
  for (const k of Object.keys(weights) as Array<keyof typeof weights>) {
    normalized[k] = Math.round((weights[k] / sum) * 1e4) / 1e4;
  }
  return { ...champion, operatorWeights: normalized };
}

/** explorations.start — creates record + champion strategy + atomically schedules execution. */
export const start = mutation({
  args: {
    problemId: v.id('problems'),
    strategyId: v.optional(v.id('strategies')),
    budgetPreset: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { problem, subject } = await requireProblemAccess(ctx, args.problemId);
    const workspaceId = problem.workspaceId;

    // resolve strategy: explicit, else workspace champion, else create v0.1
    let strategyId = args.strategyId ?? null;
    if (strategyId) {
      const s = await ctx.db.get(strategyId);
      if (!s || s.workspaceId !== workspaceId) throw new Error('strategy not found in workspace');
    } else {
      const champ = await ctx.db
        .query('strategies')
        .withIndex('by_workspace_state', (q) => q.eq('workspaceId', workspaceId).eq('state', 'champion'))
        .first();
      strategyId = champ?._id ?? null;
    }
    if (!strategyId) {
      strategyId = await ctx.db.insert('strategies', {
        workspaceId,
        version: 'v0.1',
        state: 'champion',
        config: defaultChampion('bootstrap'),
      });
    }

    // Apply the latest learned allocation (feedback loop closes here):
    // the champion config runs with weights shaped by operator performance.
    const latestDecision = await ctx.db
      .query('allocationDecisions')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .first();
    const strategyDoc = await ctx.db.get(strategyId);
    const baseConfig: SearchStrategy =
      strategyDoc?.config && (strategyDoc.config as SearchStrategy).operatorWeights
        ? (strategyDoc.config as SearchStrategy)
        : defaultChampion('bootstrap');
    const effectiveConfig = latestDecision
      ? withLearnedWeights(baseConfig, latestDecision.weights as Record<string, number> | undefined)
      : baseConfig;

    const budget = BudgetSchema.parse(budgetFor((args.budgetPreset as 'quick' | 'standard' | 'deep') ?? 'standard'));
    const explorationId = await ctx.db.insert('explorations', {
      workspaceId,
      problemId: args.problemId,
      strategyId,
      status: 'queued',
      budget,
      // provenance: exactly which strategy config (champion × learned weights) ran
      effectiveStrategy: effectiveConfig,
      appliedAllocationWeights: latestDecision?.weights ?? null,
      seed: Math.floor(Math.random() * 2 ** 31),
      errors: [],
    });

    // atomic enqueue of durable execution
    ctx.scheduler.runAfter(0, internal.internal.search.runExplorationAction, { explorationId });
    return { explorationId, status: 'queued' as const };
  },
});

export const get = query({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    const { exploration } = await requireExplorationAccess(ctx, args.explorationId);
    const ideas = await ctx.db
      .query('ideas')
      .withIndex('by_exploration', (q) => q.eq('explorationId', args.explorationId))
      .take(200);
    const evaluations = await Promise.all(
      ideas.map((i) =>
        ctx.db.query('evaluations').withIndex('by_idea', (q) => q.eq('ideaId', i._id)).first()
      )
    );
    return {
      exploration,
      ideas: ideas.map((idea, idx) => ({ ...idea, id: idea._id, evaluation: evaluations[idx] ?? null })),
    };
  },
});

export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    return ctx.db
      .query('explorations')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(30);
  },
});

export const cancel = mutation({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    const { exploration } = await requireExplorationAccess(ctx, args.explorationId);
    if (exploration.status === 'queued' || exploration.status === 'running') {
      await ctx.db.patch(args.explorationId, { status: 'cancelled', finishedAt: Date.now() });
    }
    return null;
  },
});
