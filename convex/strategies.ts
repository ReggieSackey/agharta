/**
 * Strategies: champion listing, challenge (optimization experiments), promote.
 */
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireWorkspaceMembership } from './auth';
import { buildChallenger, OptimizerOutputSchema, fallbackProposal } from '@agharta/learning';
import { defaultChampion } from '@agharta/core';
import type { SearchStrategy } from '@agharta/shared';

export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    return ctx.db
      .query('strategies')
      .withIndex('by_workspace_state', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(50);
  },
});

/** strategies.challenge — snapshot challenger + schedule the benchmark comparison. */
export const challenge = mutation({
  args: {
    baseStrategyId: v.id('strategies'),
    changeProposal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const base = await ctx.db.get(args.baseStrategyId);
    if (!base) throw new Error('NOT_FOUND');
    const { subject } = await requireWorkspaceMembership(ctx, base.workspaceId);

    // The challenger MUST differ from the champion: apply the structured
    // proposal (or a deterministic fallback tweak) to the champion config.
    const championConfig: SearchStrategy =
      (base.config as SearchStrategy | null)?.operatorWeights ? base.config : defaultChampion('bootstrap');
    let proposal;
    try {
      proposal = args.changeProposal ? OptimizerOutputSchema.parse(JSON.parse(args.changeProposal)) : fallbackProposal();
    } catch {
      proposal = fallbackProposal();
    }
    const challengerConfig = buildChallenger(championConfig as SearchStrategy, proposal, `challenger-${Date.now()}`);

    const challengerId = await ctx.db.insert('strategies', {
      workspaceId: base.workspaceId,
      version: challengerConfig.version,
      state: 'challenger',
      config: {
        ...challengerConfig,
        changeProposal: args.changeProposal ?? JSON.stringify(fallbackProposal()),
      },
    });

    const experimentId = await ctx.db.insert('optimizationExperiments', {
      workspaceId: base.workspaceId,
      incumbentStrategyId: args.baseStrategyId,
      challengerStrategyId: challengerId,
      benchmarkVersion: 'bench-v1',
      seeds: [11, 22, 33],
      championResult: null,
      challengerResult: null,
      decision: 'pending_user_promotion',
      rationale: 'awaiting benchmark run',
      createdAt: Date.now(),
    });

    ctx.scheduler.runAfter(0, internal.internal.optimize.runExperiment, {
      experimentId,
      requestedBy: subject,
    });
    return { experimentId, challengerStrategyId: challengerId };
  },
});

/** strategies.promote — owner-only, gated on predeclared criteria. */
export const promote = mutation({
  args: { experimentId: v.id('optimizationExperiments') },
  handler: async (ctx, args) => {
    const exp = await ctx.db.get(args.experimentId);
    if (!exp) throw new Error('NOT_FOUND');
    await requireWorkspaceMembership(ctx, exp.workspaceId, 'owner');

    if (exp.decision !== 'eligible_for_promotion') {
      throw new Error(`PROMOTION_GATE_NOT_SATISFIED (decision=${exp.decision})`);
    }
    const challenger = await ctx.db.get(exp.challengerStrategyId);
    const incumbent = await ctx.db.get(exp.incumbentStrategyId);
    if (!challenger || !incumbent) throw new Error('NOT_FOUND');

    await ctx.db.patch(incumbent._id, { state: 'archived' });
    await ctx.db.patch(challenger._id, {
      state: 'champion',
      promotedBy: 'owner',
      promotedAt: Date.now(),
    });
    await ctx.db.insert('promotionAudit', {
      workspaceId: exp.workspaceId,
      experimentId: args.experimentId,
      fromVersion: incumbent.version,
      toVersion: challenger.version,
      decision: 'promoted',
      by: 'owner',
      at: Date.now(),
      rationale: exp.rationale,
    });
    return { ok: true, newChampionId: challenger._id };
  },
});

/** List experiments with results (Learning page). */
export const listExperiments = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const experiments = await ctx.db
      .query('optimizationExperiments')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(20);
    const audit = await ctx.db
      .query('promotionAudit')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(20);
    return { experiments, audit };
  },
});
