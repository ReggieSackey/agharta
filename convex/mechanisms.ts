/**
 * Mechanisms: conceptual causal-approach views with honest sample sizes.
 */
import { query } from './_generated/server';
import { v } from 'convex/values';
import { requireWorkspaceMembership } from './auth';

export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces'), domain: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const mechanisms = await ctx.db
      .query('mechanisms')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(100);
    // attach idea counts + outcome breakdown per mechanism (bounded)
    const withStats = await Promise.all(
      mechanisms.map(async (m) => {
        const ideas = await ctx.db
          .query('ideas')
          .withIndex('by_mechanism', (q) => q.eq('mechanismId', m._id))
          .take(50);
        const byState = new Map<string, number>();
        for (const i of ideas) {
          const key = i.selectionState ?? 'unknown';
          byState.set(key, (byState.get(key) ?? 0) + 1);
        }
        return {
          ...m,
          id: m._id,
          ideaCount: ideas.length,
          outcomeBreakdown: Object.fromEntries(byState),
          lastUsedAt: ideas.length ? ideas[ideas.length - 1]!._creationTime : null,
        };
      })
    );
    return withStats;
  },
});

/** Mechanism detail: contributed ideas incl. failures (drawer view). */
export const detail = query({
  args: { mechanismId: v.id('mechanisms') },
  handler: async (ctx, args) => {
    const mech = await ctx.db.get(args.mechanismId);
    if (!mech) throw new Error('NOT_FOUND');
    await requireWorkspaceMembership(ctx, mech.workspaceId);
    const ideas = await ctx.db
      .query('ideas')
      .withIndex('by_mechanism', (q) => q.eq('mechanismId', args.mechanismId))
      .take(50);
    return { mechanism: { ...mech, id: mech._id }, ideas: ideas.map((i) => ({ ...i, id: i._id })) };
  },
});
