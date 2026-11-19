/**
 * Internal MCP bridge functions — invoked ONLY by http.ts after token auth.
 * They trust the workspaceId passed by the bridge (already authenticated).
 */
import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { ProblemInputSchema } from '@agharta/shared';
import { smoothQualification } from '@agharta/learning';

export const lookupTokenByPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, args) =>
    ctx.db.query('mcpTokens').withIndex('by_prefix', (q) => q.eq('tokenPrefix', args.prefix)).take(5),
});

export const createProblem = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    title: v.string(),
    description: v.string(),
    desiredOutcome: v.string(),
    constraints: v.array(v.string()),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    const input = ProblemInputSchema.parse({
      title: args.title,
      description: args.description,
      desiredOutcome: args.desiredOutcome,
      constraints: args.constraints,
      domain: args.domain,
    });
    return ctx.db.insert('problems', {
      workspaceId: args.workspaceId,
      creatorSubject: 'mcp-token',
      title: input.title,
      description: input.description,
      desiredOutcome: input.desiredOutcome,
      domain: input.domain,
      constraints: input.constraints,
      previousAttempts: [],
    });
  },
});

export const startExploration = internalMutation({
  args: { problemId: v.id('problems'), budgetPreset: v.string() },
  handler: async (ctx, args) => {
    const problem = await ctx.db.get(args.problemId);
    if (!problem) throw new Error('NOT_FOUND');
    const champ = await ctx.db
      .query('strategies')
      .withIndex('by_workspace_state', (q) => q.eq('workspaceId', problem.workspaceId).eq('state', 'champion'))
      .first();
    let strategyId = champ?._id ?? null;
    if (!strategyId) {
      strategyId = await ctx.db.insert('strategies', {
        workspaceId: problem.workspaceId,
        version: 'v0.1',
        state: 'champion',
        config: null,
      });
    }
    const explorationId = await ctx.db.insert('explorations', {
      workspaceId: problem.workspaceId,
      problemId: args.problemId,
      strategyId,
      status: 'queued',
      budget: { preset: args.budgetPreset, maxCandidates: 24, maxGenerations: 2, maxCostUsd: 1.5, maxWallClockMs: 300000 },
      seed: Math.floor(Math.random() * 2 ** 31),
      errors: [],
    });
    ctx.scheduler.runAfter(0, internal.internal.search.runExplorationAction, { explorationId });
    return { explorationId };
  },
});

export const getExplorationForToken = internalQuery({
  args: { workspaceId: v.id('workspaces'), explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId);
    if (!ex || ex.workspaceId !== args.workspaceId) return null;
    const ideas = await ctx.db
      .query('ideas')
      .withIndex('by_exploration', (q) => q.eq('explorationId', args.explorationId))
      .take(50);
    const withEval = await Promise.all(
      ideas.map(async (i) => {
        const e = await ctx.db.query('evaluations').withIndex('by_idea', (q) => q.eq('ideaId', i._id)).first();
        return {
          id: i._id,
          title: i.title,
          intervention: i.intervention,
          causalMechanism: i.causalMechanism,
          operator: i.operatorId,
          generation: i.generation,
          parents: i.parentIds,
          sources: i.sourceConceptIds,
          evaluation: e
            ? {
                originality: e.originality,
                usefulness: e.usefulness,
                feasibility: e.feasibility,
                uncertainty: e.uncertainty,
                evidenceKind: 'automated_proxy' as const,
              }
            : null,
        };
      })
    );
    // top diverse ideas: selected first, then by proxy score
    const ranked = withEval.sort((a, b) => {
      const pa = a.evaluation ? a.evaluation.originality + a.evaluation.usefulness + a.evaluation.feasibility : 0;
      const pb = b.evaluation ? b.evaluation.originality + b.evaluation.usefulness + b.evaluation.feasibility : 0;
      return pb - pa;
    });
    return {
      status: ex.status,
      progress: ex.progress ?? 0,
      stage: ex.stage ?? null,
      usage: ex.usage ?? null,
      ideas: ranked.slice(0, 8),
      note: 'scores are automated proxy evidence, not outcomes',
    };
  },
});

export const submitFeedback = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    ideaId: v.id('ideas'),
    action: v.string(),
    reason: v.optional(v.string()),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const idea = await ctx.db.get(args.ideaId);
    if (!idea || idea.workspaceId !== args.workspaceId) throw new Error('NOT_FOUND');
    await ctx.db.insert('ideaFeedback', {
      workspaceId: args.workspaceId,
      ideaId: args.ideaId,
      actorSubject: 'mcp-token',
      action: args.action,
      reason: args.reason,
      evidence: args.evidence,
      verificationStatus: 'self_reported',
    });
    await ctx.db.patch(args.ideaId, { selectionState: args.action });
    ctx.scheduler.runAfter(0, internal.internal.learning.recomputeOperatorStats, {
      workspaceId: args.workspaceId,
    });
    return { ok: true, newStatus: args.action };
  },
});

export const learningSummary = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('operatorStats')
      .withIndex('by_workspace_operator', (q) => q.eq('workspaceId', args.workspaceId))
      .take(50);
    return rows.map((r) => ({
      operatorId: r.operatorId,
      domain: r.domain,
      counters: r.counters,
      estimate: smoothQualification(r.counters as never),
      evidence: 'proxy estimates are automated; outcomes are user-reported',
    }));
  },
});
