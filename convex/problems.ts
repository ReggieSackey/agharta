import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { requireWorkspaceMembership, requireProblemAccess } from './auth';
import { ProblemInputSchema } from '@agharta/shared';

/** problems.create — validated, authorized, indexed. */
export const create = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    title: v.string(),
    description: v.string(),
    desiredOutcome: v.string(),
    constraints: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
    previouslyTried: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const input = ProblemInputSchema.parse({
      title: args.title,
      description: args.description,
      desiredOutcome: args.desiredOutcome,
      constraints: args.constraints ?? [],
      domain: args.domain ?? 'other',
      previouslyTried: args.previouslyTried ?? [],
    });
    const { subject } = await requireWorkspaceMembership(ctx, args.workspaceId);
    return ctx.db.insert('problems', {
      workspaceId: args.workspaceId,
      creatorSubject: subject,
      title: input.title,
      description: input.description,
      desiredOutcome: input.desiredOutcome,
      domain: input.domain,
      constraints: input.constraints,
      previousAttempts: input.previouslyTried,
    });
  },
});

export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    return ctx.db
      .query('problems')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(50);
  },
});

export const get = query({
  args: { problemId: v.id('problems') },
  handler: async (ctx, args) => {
    const { problem } = await requireProblemAccess(ctx, args.problemId);
    const explorations = await ctx.db
      .query('explorations')
      .withIndex('by_problem', (q) => q.eq('problemId', args.problemId))
      .order('desc')
      .take(20);
    return { problem, explorations };
  },
});
