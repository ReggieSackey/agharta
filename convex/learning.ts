/**
 * Learning: operator stats storage, allocation decisions, summaries.
 */
import { query } from './_generated/server';
import { v } from 'convex/values';
import { requireWorkspaceMembership } from './auth';
import { smoothQualification, smoothOutcome, emptyCounters } from '@agharta/learning';
import type { OperatorCounters } from '@agharta/learning';

/** learning.summary — per-workspace operator performance with uncertainty + evidence labels. */
export const summary = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const rows = await ctx.db
      .query('operatorStats')
      .withIndex('by_workspace_operator', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();
    const out = [] as Array<{
      operatorId: string;
      domain: string;
      counters: OperatorCounters;
      proxyEstimate: { mean: number; uncertainty: number; sampleSize: number; insufficientData: boolean };
      outcomeEstimate: { mean: number; uncertainty: number; sampleSize: number; insufficientData: boolean };
    }>;
    for (const r of rows) {
      const counters = r.counters as OperatorCounters;
      out.push({
        operatorId: r.operatorId,
        domain: r.domain,
        counters,
        proxyEstimate: smoothQualification(counters),
        outcomeEstimate: smoothOutcome(counters),
      });
    }
    const decisions = await ctx.db
      .query('allocationDecisions')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(10);
    return { operators: out, recentDecisions: decisions, emptyCounters: emptyCounters() };
  },
});

/** Feedback coverage: how many outcomes are unknown (drives the learning page). */
export const feedbackCoverage = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const rows = await ctx.db
      .query('operatorStats')
      .withIndex('by_workspace_operator', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();
    let shortlisted = 0;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let unknown = 0;
    for (const r of rows) {
      const c = r.counters as OperatorCounters;
      shortlisted += c.shortlisted;
      attempted += c.attempted;
      succeeded += c.succeeded;
      failed += c.failed;
      unknown += Math.max(0, c.shortlisted + c.attempted - c.succeeded - c.failed);
    }
    return { shortlisted, attempted, succeeded, failed, unknown };
  },
});
