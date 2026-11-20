/**
 * Credential storage mutation (internal only, workspace-bound).
 */
import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';

export const storeEncrypted = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    provider: v.string(),
    encrypted: v.string(),
    keyFingerprint: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('providerCredentials')
      .withIndex('by_workspace_provider', (q) => q.eq('workspaceId', args.workspaceId).eq('provider', args.provider))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        encrypted: args.encrypted,
        keyFingerprint: args.keyFingerprint,
        label: args.label,
        updatedAt: Date.now(),
      });
      return { updated: true };
    }
    await ctx.db.insert('providerCredentials', {
      workspaceId: args.workspaceId,
      provider: args.provider,
      encrypted: args.encrypted,
      keyFingerprint: args.keyFingerprint,
      label: args.label,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { updated: false };
  },
});
