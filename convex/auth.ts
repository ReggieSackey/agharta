/**
 * Server-side identity + workspace authorization helpers.
 * Every public query/mutation/action MUST call one of these before touching data.
 * Identity comes ONLY from the verified JWT (`subject`); user-editable profile
 * fields are never an authority source.
 */
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx, MutationCtx, ActionCtx } from './_generated/server';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Extract verified identity; throws when unauthenticated. */
export async function requireIdentity(ctx: QueryCtx | MutationCtx): Promise<{ subject: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.subject) {
    throw new AuthError('UNAUTHENTICATED');
  }
  return { subject: identity.subject };
}

/** Ensure user record exists (called after login / before workspace ops). */
export async function ensureUser(ctx: MutationCtx, subject: string): Promise<Id<'users'>> {
  const existing = await ctx.db
    .query('users')
    .withIndex('by_subject', (q) => q.eq('subject', subject))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert('users', { subject });
}

/** Every new user gets exactly one private workspace (owner). */
export async function ensureDefaultWorkspace(ctx: MutationCtx, subject: string): Promise<Id<'workspaces'>> {
  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_user_workspace', (q) => q.eq('userSubject', subject))
    .first();
  if (membership) return membership.workspaceId;
  const wsId = await ctx.db.insert('workspaces', {
    name: 'Personal workspace',
    creatorSubject: subject,
  });
  await ctx.db.insert('workspaceMembers', {
    workspaceId: wsId,
    userSubject: subject,
    role: 'owner',
  });
  return wsId;
}

/** Central authorization gate. Throws unless member (optionally owner). */
export async function requireWorkspaceMembership(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspaces'>,
  role?: 'owner'
): Promise<{ subject: string; membership: Doc<'workspaceMembers'> }> {
  const { subject } = await requireIdentity(ctx);
  const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_user_workspace', (q) => q.eq('userSubject', subject).eq('workspaceId', workspaceId))
    .unique();
  if (!membership) throw new AuthError('FORBIDDEN: not a member of this workspace');
  if (role === 'owner' && membership.role !== 'owner') {
    throw new AuthError('FORBIDDEN: owner role required');
  }
  return { subject, membership };
}

/** Resolve an exploration and verify workspace access in one step. */
export async function requireExplorationAccess(
  ctx: QueryCtx | MutationCtx,
  explorationId: Id<'explorations'>
): Promise<{ exploration: Doc<'explorations'>; subject: string }> {
  const exploration = await ctx.db.get(explorationId);
  if (!exploration) throw new AuthError('NOT_FOUND');
  const { subject } = await requireWorkspaceMembership(ctx, exploration.workspaceId);
  return { exploration, subject };
}

/** Resolve an idea and verify workspace access. */
export async function requireIdeaAccess(
  ctx: QueryCtx | MutationCtx,
  ideaId: Id<'ideas'>
): Promise<{ idea: Doc<'ideas'>; subject: string }> {
  const idea = await ctx.db.get(ideaId);
  if (!idea) throw new AuthError('NOT_FOUND');
  const { subject } = await requireWorkspaceMembership(ctx, idea.workspaceId);
  return { idea, subject };
}

/** Resolve a problem and verify workspace access. */
export async function requireProblemAccess(
  ctx: QueryCtx | MutationCtx,
  problemId: Id<'problems'>
): Promise<{ problem: Doc<'problems'>; subject: string }> {
  const problem = await ctx.db.get(problemId);
  if (!problem) throw new AuthError('NOT_FOUND');
  const { subject } = await requireWorkspaceMembership(ctx, problem.workspaceId);
  return { problem, subject };
}
