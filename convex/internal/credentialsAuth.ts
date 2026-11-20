/** Internal: workspace resolution for credential actions. */
import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { requireIdentity, ensureUser, ensureDefaultWorkspace } from '../auth';

export const myWorkspace = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { subject } = await requireIdentity(ctx);
    await ensureUser(ctx, subject);
    const workspaceId = await ensureDefaultWorkspace(ctx, subject);
    return { workspaceId, subject };
  },
});
