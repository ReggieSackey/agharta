/**
 * Ideas: bounded listing, detail with lineage, feedback state.
 */
import { query } from './_generated/server';
import { v } from 'convex/values';
import { requireIdeaAccess, requireExplorationAccess } from './auth';
import type { Id, Doc } from './_generated/dataModel';

export const listByExploration = query({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    await requireExplorationAccess(ctx, args.explorationId);
    const ideas = await ctx.db
      .query('ideas')
      .withIndex('by_exploration', (q) => q.eq('explorationId', args.explorationId))
      .take(200);
    const evaluations = await Promise.all(
      ideas.map((i) =>
        ctx.db.query('evaluations').withIndex('by_idea', (q) => q.eq('ideaId', i._id)).first()
      )
    );
    return ideas.map((idea, idx) => ({
      ...idea,
      id: idea._id,
      evaluation: evaluations[idx] ?? null,
    }));
  },
});

/** Full idea detail + ancestry (bounded depth). */
export const getWithLineage = query({
  args: { ideaId: v.id('ideas') },
  handler: async (ctx, args) => {
    const { idea } = await requireIdeaAccess(ctx, args.ideaId);
    const evaluation = await ctx.db
      .query('evaluations')
      .withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId))
      .first();
    const feedback = await ctx.db
      .query('ideaFeedback')
      .withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId))
      .take(20);

    // walk ancestry up to 4 hops (bounded)
    const ancestors: Array<Record<string, unknown>> = [];
    let frontier = [...idea.parentIds];
    const seen = new Set<string>([idea._id]);
    for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const pid of frontier) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const parent = (await ctx.db.get(pid as Id<'ideas'>)) as Doc<'ideas'> | null;
        if (parent) {
          ancestors.push({ ...parent, id: pid, depth: depth + 1 });
          next.push(...(parent.parentIds ?? []));
        }
      }
      frontier = next;
    }
    const sources = await ctx.db
      .query('ideaSources')
      .withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId))
      .take(10);
    return { idea: { ...idea, id: idea._id }, evaluation: evaluation ?? null, feedback, ancestors, sources };
  },
});
