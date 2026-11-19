/**
 * Learning recomputation: rebuild operatorStats from feedback + invocations
 * (idempotent full recomputation per workspace). Runs as internal action via
 * scheduler; unknown outcomes never counted as failures.
 */
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { applyCredit, emptyCounters, decideAllocation, DEFAULT_EXPLORATION_FLOOR } from '@agharta/learning';
import type { OperatorCounters } from '@agharta/learning';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

export const recomputeOperatorStats = internalAction({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.internal.learning.loadWorkspaceSignals, {
      workspaceId: args.workspaceId,
    });
    const { ideas, feedback, invocations, existingStats } = data as unknown as {
      ideas: Array<{ _id: Id<'ideas'>; operatorId: string; explorationId: Id<'explorations'>; selectionState?: string; causalMechanism: string; generation: number }>;
      feedback: Array<{ ideaId: Id<'ideas'>; action: string }>;
      invocations: Array<{ operator: string; outputsGenerated: number }>;
      existingStats: Array<{ _id: Id<'operatorStats'>; domain: string; operatorId: string }>;
    };
    // We need exploration→problem mapping; loaded separately
    const explorations = await ctx.runQuery(internal.internal.learning.loadWorkspaceExplorations, {
      workspaceId: args.workspaceId,
    });
    const problemDocs = await ctx.runQuery(internal.internal.learning.loadWorkspaceProblems, {
      workspaceId: args.workspaceId,
    });
    const exToProblem = new Map(explorations.map((e: { _id: Id<'explorations'>; problemId: Id<'problems'> }) => [e._id, e.problemId]));
    const problemDomain = new Map(problemDocs.map((p: { _id: Id<'problems'>; domain: string }) => [p._id, p.domain]));

    const feedbackByIdea = new Map<string, string>();
    for (const f of feedback) feedbackByIdea.set(f.ideaId, f.action);

    // (domain, operator) → counters
    const stats = new Map<string, OperatorCounters>();
    const key = (d: string, o: string) => `${d}|${o}`;
    const bump = (d: string, o: string, fn: (c: OperatorCounters) => OperatorCounters) => {
      const c = stats.get(key(d, o)) ?? emptyCounters();
      stats.set(key(d, o), fn(c));
    };

    for (const inv of invocations) {
      bump('all', inv.operator, (c) => applyCredit(c, { operatorId: inv.operator as never, domain: 'all', kind: 'generated' }));
      // generated counts scale with outputs
      for (let i = 1; i < inv.outputsGenerated; i++) {
        bump('all', inv.operator, (c) => applyCredit(c, { operatorId: inv.operator as never, domain: 'all', kind: 'generated' }));
      }
    }
    for (const idea of ideas) {
      const domain = problemDomain.get(exToProblem.get(idea.explorationId) ?? '' as Id<'problems'>) ?? 'other';
      bump(domain, idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain, kind: 'unique' }));
      bump('all', idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain: 'all', kind: 'unique' }));
      const action = feedbackByIdea.get(idea._id);
      if (action) {
        bump(domain, idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain, kind: 'feedback', action: action as never }));
        bump('all', idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain: 'all', kind: 'feedback', action: action as never }));
      }
      // provisional qualification proxy: an idea with no feedback and unknown
      // state is only counted as unique; qualified ones are those selected
      if (idea.selectionState === 'selected') {
        bump(domain, idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain, kind: 'provisionally_qualified' }));
        bump('all', idea.operatorId, (c) => applyCredit(c, { operatorId: idea.operatorId as never, domain: 'all', kind: 'provisionally_qualified' }));
      }
    }

    await ctx.runMutation(internal.internal.learning.writeOperatorStats, {
      workspaceId: args.workspaceId,
      rows: [...stats.entries()].map(([k, counters]) => {
        const [domain, operatorId] = k.split('|');
        return { domain: domain!, operatorId: operatorId!, counters };
      }),
    });

    // allocation decision from recomputed stats (logged with seed)
    const statsMap = { divergent: emptyCounters(), analogy: emptyCounters(), inversion: emptyCounters(), recombination: emptyCounters() };
    for (const [k, c] of stats) {
      if (k.startsWith('all|')) {
        const op = k.split('|')[1] as keyof typeof statsMap;
        statsMap[op] = c;
      }
    }
    const decision = decideAllocation(statsMap, Date.now() % 2 ** 31, DEFAULT_EXPLORATION_FLOOR);
    await ctx.runMutation(internal.internal.learning.writeAllocationDecision, {
      workspaceId: args.workspaceId,
      weights: decision.weights,
      reason: decision.reason,
      seed: decision.seed,
    });
    return { rowsWritten: stats.size };
  },
});

export const loadWorkspaceSignals = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    // bounded per-workspace scans through indexes
    const explorations = await ctx.db
      .query('explorations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(100);
    const ideas = [];
    const invocations = [];
    for (const ex of explorations) {
      const exIdeas = await ctx.db
        .query('ideas')
        .withIndex('by_exploration', (q) => q.eq('explorationId', ex._id))
        .take(200);
      ideas.push(...exIdeas);
      const exInv = await ctx.db
        .query('operatorInvocations')
        .withIndex('by_exploration', (q) => q.eq('explorationId', ex._id))
        .take(50);
      invocations.push(...exInv);
    }
    const feedback = await ctx.db
      .query('ideaFeedback')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(500);
    const existingStats = await ctx.db
      .query('operatorStats')
      .withIndex('by_workspace_operator', (q) => q.eq('workspaceId', args.workspaceId))
      .take(100);
    return { ideas, feedback, invocations, existingStats };
  },
});

export const loadWorkspaceExplorations = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) =>
    ctx.db
      .query('explorations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(100),
});

export const loadWorkspaceProblems = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) =>
    ctx.db
      .query('problems')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(100),
});

export const writeOperatorStats = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    rows: v.array(v.object({ domain: v.string(), operatorId: v.string(), counters: v.any() })),
  },
  handler: async (ctx, args) => {
    // clear and rewrite (idempotent full recomputation)
    const existing = await ctx.db
      .query('operatorStats')
      .withIndex('by_workspace_operator', (q) => q.eq('workspaceId', args.workspaceId))
      .take(200);
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of args.rows) {
      await ctx.db.insert('operatorStats', {
        workspaceId: args.workspaceId,
        domain: row.domain,
        operatorId: row.operatorId,
        counters: row.counters,
        updatedAt: Date.now(),
      });
    }
  },
});

export const writeAllocationDecision = internalMutation({
  args: { workspaceId: v.id('workspaces'), weights: v.any(), reason: v.string(), seed: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert('allocationDecisions', {
      workspaceId: args.workspaceId,
      weights: args.weights,
      reason: args.reason,
      seed: args.seed,
      createdAt: Date.now(),
    });
  },
});
