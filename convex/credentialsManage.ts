/**
 * BYOK credential management queries/mutations (no node APIs needed).
 * setCredential (node action) lives in credentials.ts.
 */
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { requireIdentity, ensureUser, ensureDefaultWorkspace } from './auth';

async function myWorkspace(ctx: any): Promise<{ workspaceId: any; subject: string }> {
  const { subject } = await requireIdentity(ctx);
  await ensureUser(ctx, subject);
  const workspaceId = await ensureDefaultWorkspace(ctx, subject);
  return { workspaceId, subject };
}

/** Metadata only — ciphertext and plaintext are NEVER returned. */
export const listCredentials = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .take(20);
    return rows.map((r) => ({
      provider: r.provider,
      label: r.label,
      keyFingerprint: r.keyFingerprint,
      hasKey: true,
      updatedAt: r.updatedAt,
    }));
  },
});

export const deleteCredential = mutation({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const { workspaceId } = await myWorkspace(ctx);
    const existing = await ctx.db
      .query('providerCredentials')
      .withIndex('by_workspace_provider', (q) => q.eq('workspaceId', workspaceId).eq('provider', args.provider))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});