import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { requireIdentity, ensureUser, ensureDefaultWorkspace } from './auth';

/** Called by the web app after AuthKit session is established. */
export const getOrCreateMe = mutation({
  args: { displayName: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { subject } = await requireIdentity(ctx);
    const userId = await ensureUser(ctx, subject);
    const workspaceId = await ensureDefaultWorkspace(ctx, subject);
    if (args.displayName !== undefined || args.email !== undefined) {
      const user = await ctx.db.get(userId);
      if (user) {
        await ctx.db.patch(userId, {
          displayName: args.displayName ?? user.displayName,
          email: args.email ?? user.email,
        });
      }
    }
    return { userId, workspaceId, subject };
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const { subject } = await requireIdentity(ctx);
    const user = await ctx.db.query('users').withIndex('by_subject', (q) => q.eq('subject', subject)).unique();
    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_user_workspace', (q) => q.eq('userSubject', subject))
      .first();
    return { user, workspaceId: membership?.workspaceId ?? null };
  },
});
