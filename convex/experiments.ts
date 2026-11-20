/**
 * V2 public API: experiments (start, get, list), learning artifacts (versions,
 * active, rollback), feedback linking. All workspace-authorized.
 */
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireIdentity, ensureUser, ensureDefaultWorkspace, AuthError } from './auth';

/** Resolve the caller's default workspace (creating on first use). */
async function myWorkspace(ctx: any): Promise<{ workspaceId: import('./_generated/dataModel').Id<'workspaces'>; subject: string }> {
  const { subject } = await requireIdentity(ctx);
  await ensureUser(ctx, subject);
  const workspaceId = await ensureDefaultWorkspace(ctx, subject);
  return { workspaceId, subject };
}

// ---------------------------------------------------------------------------
// experiments
// ---------------------------------------------------------------------------

export const start = mutation({
  args: {
    problemText: v.string(),
    domain: v.string(),
    budgetPreset: v.union(v.literal('quick'), v.literal('standard'), v.literal('deep')),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = await myWorkspace(ctx);
    await ctx.runMutation(internal.internal.v2store.seedArtifactsIfAbsent, { workspaceId });
    const problemId = await ctx.db.insert('problems', {
      workspaceId,
      creatorSubject: (await requireIdentity(ctx)).subject,
      title: args.title ?? args.problemText.slice(0, 80),
      description: args.problemText,
      desiredOutcome: '(structured by Engine 1 at interpret step)',
      domain: args.domain,
    });
    const now = Date.now();
    const experimentId = await ctx.db.insert('experiments', {
      workspaceId,
      problemId,
      problemText: args.problemText,
      record: null,
      status: 'queued',
      mapVersionId: '',
      policyVersionId: '',
      processedByLearning: false,
      startedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.internal.v2.runV2Experiment, {
      experimentDocId: experimentId,
      workspaceId,
      problemId,
      problemText: args.problemText,
      domain: args.domain,
      budgetPreset: args.budgetPreset,
      seed: now % 2147483647,
    });
    return { experimentId, problemId };
  },
});

export const get = query({
  args: { experimentId: v.id('experiments') },
  handler: async (ctx, args) => {
    const { workspaceId } = await myWorkspace(ctx);
    const doc = await ctx.db.get(args.experimentId);
    if (!doc || doc.workspaceId !== workspaceId) return null;
    return {
      _id: doc._id,
      status: doc.status,
      record: doc.record,
      mapVersionId: doc.mapVersionId,
      policyVersionId: doc.policyVersionId,
      startedAt: doc.startedAt,
      finishedAt: doc.finishedAt,
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    const rows = await ctx.db
      .query('experiments')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(50);
    return rows.map((r) => ({
      _id: r._id,
      status: r.status,
      problemText: r.problemText,
      mapVersionId: r.mapVersionId,
      policyVersionId: r.policyVersionId,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      finalCount: r.record?.finalProposals?.length ?? 0,
    }));
  },
});

// ---------------------------------------------------------------------------
// learning artifacts + audit
// ---------------------------------------------------------------------------

export const activeArtifacts = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    const [mapDoc] = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', workspaceId).eq('isActive', true))
      .take(1);
    const [policyDoc] = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', workspaceId).eq('isActive', true))
      .take(1);
    const runs = await ctx.db
      .query('learningRuns')
      .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(20);
    return {
      map: mapDoc ? { versionId: mapDoc.versionId, version: mapDoc.version, artifact: mapDoc.artifact } : null,
      policy: policyDoc ? { versionId: policyDoc.versionId, version: policyDoc.version, artifact: policyDoc.artifact } : null,
      recentLearningRuns: runs.map((r) => ({
        _id: r._id,
        status: r.status,
        inputHash: r.inputHash,
        candidatePolicyVersionId: r.candidatePolicyVersionId,
        evaluation: r.evaluation,
        error: r.error,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
      })),
    };
  },
});

export const learningHistory = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    const runs = await ctx.db
      .query('learningRuns')
      .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(50);
    const audits = await ctx.db
      .query('promotionAudit')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(50);
    return {
      runs: runs.map((r) => ({
        _id: r._id,
        status: r.status,
        experimentIds: r.experimentIds,
        candidatePolicyVersionId: r.candidatePolicyVersionId,
        evaluation: r.evaluation,
        notes: r.notes,
        error: r.error,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
      })),
      promotions: audits
        .filter((a) => a.decision === 'auto_promote' || a.decision === 'rollback')
        .map((a) => ({
          _id: a._id,
          fromVersion: a.fromVersion,
          toVersion: a.toVersion,
          decision: a.decision,
          at: a.at,
          rationale: a.rationale,
        })),
    };
  },
});

export const listPolicyVersions = query({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    const rows = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', workspaceId))
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      versionId: r.versionId,
      version: r.version,
      isActive: r.isActive ?? false,
      createdAt: r.createdAt,
      slots: r.artifact?.slots,
      explorationFloor: r.artifact?.explorationFloor,
      distancePreference: r.artifact?.distancePreference,
      weightCount: Object.keys(r.artifact?.compatWeights ?? {}).length,
    }));
  },
});

/** Owner-only rollback to a previous artifact pair. Atomic flip + audit. */
export const rollbackTo = mutation({
  args: { mapVersionId: v.string(), policyVersionId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { workspaceId, subject } = await myWorkspace(ctx);
    // owner check
    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_user_workspace', (q) => q.eq('userSubject', subject).eq('workspaceId', workspaceId))
      .unique();
    if (!membership || membership.role !== 'owner') {
      throw new AuthError('FORBIDDEN: owner role required for rollback');
    }
    await ctx.runMutation(internal.internal.v2store.promoteArtifacts, {
      workspaceId,
      mapVersionId: args.mapVersionId,
      policyVersionId: args.policyVersionId,
      decision: 'rollback',
      rationale: args.reason ?? 'manual rollback via dashboard',
    });
    await ctx.runMutation(internal.internal.guard.audit, {
      workspaceId,
      category: 'rollback',
      action: 'manual_rollback',
      detail: JSON.stringify({
        mapVersionId: args.mapVersionId,
        policyVersionId: args.policyVersionId,
        reason: args.reason ?? null,
      }),
      at: Date.now(),
    });
    return { rolledBackTo: { map: args.mapVersionId, policy: args.policyVersionId } };
  },
});

/** Manually trigger a learning pass (also runs automatically post-experiment). */
export const triggerLearning = mutation({
  args: {},
  handler: async (ctx) => {
    const { workspaceId } = await myWorkspace(ctx);
    await ctx.scheduler.runAfter(0, internal.internal.v2.processV2Learning, { workspaceId });
    return { scheduled: true };
  },
});
