/**
 * V2 internal store: queries + mutations backing convex/internal/v2.ts.
 * All workspace-scoped. Artifact versioning is append-only; promotion flips
 * isActive atomically inside one mutation.
 */
import { internalQuery, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { initialConceptualMap, initialSearchPolicy } from '@agharta/learning';
import type { ConceptualMap, SearchPolicy } from '@agharta/shared';
import type { Id } from '../_generated/dataModel';

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

export const seedArtifactsIfAbsent = internalMutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(1);
    if (existing.length > 0) return { seeded: false };
    const now = Date.now();
    const map = initialConceptualMap(now);
    const policy = initialSearchPolicy(now);
    await ctx.db.insert('conceptualMapVersions', {
      workspaceId: args.workspaceId, versionId: map.versionId, version: map.version,
      artifact: map, isActive: true, createdAt: now,
    });
    await ctx.db.insert('policyVersions', {
      workspaceId: args.workspaceId, versionId: policy.versionId, version: policy.version,
      artifact: policy, isActive: true, createdAt: now,
    });
    return { seeded: true };
  },
});

/** Load active artifacts; seeds them first if absent (idempotent). */
export const ensureActiveArtifacts = internalMutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const [mapDoc] = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(1);
    const [policyDoc] = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(1);
    if (mapDoc && policyDoc) {
      return {
        map: mapDoc.artifact as ConceptualMap,
        policy: policyDoc.artifact as SearchPolicy,
      };
    }
    const now = Date.now();
    const map = initialConceptualMap(now);
    const policy = initialSearchPolicy(now);
    await ctx.db.insert('conceptualMapVersions', {
      workspaceId: args.workspaceId, versionId: map.versionId, version: map.version,
      artifact: map, isActive: true, createdAt: now,
    });
    await ctx.db.insert('policyVersions', {
      workspaceId: args.workspaceId, versionId: policy.versionId, version: policy.version,
      artifact: policy, isActive: true, createdAt: now,
    });
    return { map, policy };
  },
});

export const loadActiveArtifacts = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const [mapDoc] = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(1);
    const [policyDoc] = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(1);
    if (mapDoc && policyDoc) {
      return {
        map: mapDoc.artifact as ConceptualMap,
        policy: policyDoc.artifact as SearchPolicy,
      };
    }
    return { map: null, policy: null };
  },
});

export const insertArtifactVersions = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    map: v.any(),
    policy: v.any(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const map = args.map as ConceptualMap;
    const policy = args.policy as SearchPolicy;
    const mapId = await ctx.db.insert('conceptualMapVersions', {
      workspaceId: args.workspaceId, versionId: map.versionId, version: map.version,
      artifact: map, isActive: args.isActive, createdAt: Date.now(),
    });
    const policyId = await ctx.db.insert('policyVersions', {
      workspaceId: args.workspaceId, versionId: policy.versionId, version: policy.version,
      artifact: policy, isActive: args.isActive, createdAt: Date.now(),
    });
    return { mapDocId: mapId as Id<'conceptualMapVersions'>, policyDocId: policyId as Id<'policyVersions'> };
  },
});

/**
 * Atomic promotion: flip isActive to the challenger in ONE mutation, log the
 * audit entry, and mark the learning run promoted. Rollback reuses this with
 * older version ids.
 */
export const promoteArtifacts = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    mapVersionId: v.string(),
    policyVersionId: v.string(),
    learningRunId: v.optional(v.id('learningRuns')),
    decision: v.string(), // 'auto_promote' | 'rollback' | 'manual'
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    // clear current active flags
    const activeMaps = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(10);
    for (const doc of activeMaps) await ctx.db.patch(doc._id, { isActive: false });
    const activePolicies = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
      .take(10);
    for (const doc of activePolicies) await ctx.db.patch(doc._id, { isActive: false });
    // set the new actives
    const maps = await ctx.db
      .query('conceptualMapVersions')
      .withIndex('by_workspace_version', (q) => q.eq('workspaceId', args.workspaceId).eq('versionId', args.mapVersionId))
      .take(1);
    const policies = await ctx.db
      .query('policyVersions')
      .withIndex('by_workspace_version', (q) => q.eq('workspaceId', args.workspaceId).eq('versionId', args.policyVersionId))
      .take(1);
    if (maps.length === 0 || policies.length === 0) throw new Error('promotion target version not found');
    await ctx.db.patch(maps[0]!._id, { isActive: true });
    await ctx.db.patch(policies[0]!._id, { isActive: true });
    // audit
    await ctx.db.insert('promotionAudit', {
      workspaceId: args.workspaceId,
      experimentId: undefined, // v2 promotions are artifact-level
      fromVersion: 'artifacts',
      toVersion: `${args.mapVersionId}|${args.policyVersionId}`,
      decision: args.decision,
      by: 'engine2',
      at: Date.now(),
      rationale: args.rationale,
    });
    if (args.learningRunId) {
      await ctx.db.patch(args.learningRunId, {
        status: args.decision === 'auto_promote' ? 'promoted' : 'retained',
        finishedAt: Date.now(),
      });
    }
    return { mapVersionId: args.mapVersionId, policyVersionId: args.policyVersionId };
  },
});

// ---------------------------------------------------------------------------
// experiments
// ---------------------------------------------------------------------------

export const persistExperiment = internalMutation({
  args: {
    experimentDocId: v.id('experiments'),
    record: v.any(),
    mapVersionId: v.string(),
    policyVersionId: v.string(),
  },
  handler: async (ctx, args) => {
    const record = args.record as import('@agharta/shared').ExperimentRecord;
    await ctx.db.patch(args.experimentDocId, {
      record,
      status: record.status,
      mapVersionId: args.mapVersionId,
      policyVersionId: args.policyVersionId,
      finishedAt: record.finishedAt ?? Date.now(),
    });
  },
});

export const persistExperimentFailure = internalMutation({
  args: {
    experimentDocId: v.id('experiments'),
    error: v.string(),
    mapVersionId: v.optional(v.string()),
    policyVersionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.experimentDocId, {
      status: 'failed',
      record: {
        id: args.experimentDocId,
        errors: [args.error],
        status: 'failed',
        startedAt: Date.now(),
        finishedAt: Date.now(),
      },
      mapVersionId: args.mapVersionId,
      policyVersionId: args.policyVersionId,
      finishedAt: Date.now(),
    });
  },
});

export const loadPendingExperiments = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('experiments')
      .withIndex('by_workspace_unprocessed', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('processedByLearning', false).eq('status', 'completed'))
      .take(20);
    return rows.map((r) => ({
      experimentId: r.record?.id ?? r._id,
      docId: r._id,
      record: r.record,
    }));
  },
});

export const markExperimentsProcessed = internalMutation({
  args: { docIds: v.array(v.id('experiments')) },
  handler: async (ctx, args) => {
    for (const id of args.docIds) await ctx.db.patch(id, { processedByLearning: true });
  },
});

// ---------------------------------------------------------------------------
// learning runs
// ---------------------------------------------------------------------------

export const findLearningRunByHash = internalQuery({
  args: { inputHash: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('learningRuns')
      .withIndex('by_input_hash', (q) => q.eq('inputHash', args.inputHash))
      .take(1);
    return rows[0] ?? null;
  },
});

export const createLearningRun = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    experimentIds: v.array(v.string()),
    inputHash: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('learningRuns', {
      workspaceId: args.workspaceId,
      status: 'pending',
      experimentIds: args.experimentIds,
      inputHash: args.inputHash,
      createdAt: Date.now(),
    });
    return id as Id<'learningRuns'>;
  },
});

export const updateLearningRun = internalMutation({
  args: {
    learningRunId: v.id('learningRuns'),
    status: v.optional(v.string()),
    candidateMapVersionId: v.optional(v.string()),
    candidatePolicyVersionId: v.optional(v.string()),
    championMapVersionId: v.optional(v.string()),
    championPolicyVersionId: v.optional(v.string()),
    evaluation: v.optional(v.any()),
    notes: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.status) patch.status = args.status;
    if (args.candidateMapVersionId) patch.candidateMapVersionId = args.candidateMapVersionId;
    if (args.candidatePolicyVersionId) patch.candidatePolicyVersionId = args.candidatePolicyVersionId;
    if (args.championMapVersionId) patch.championMapVersionId = args.championMapVersionId;
    if (args.championPolicyVersionId) patch.championPolicyVersionId = args.championPolicyVersionId;
    if (args.evaluation) patch.evaluation = args.evaluation;
    if (args.notes) patch.notes = args.notes;
    if (args.error) patch.error = args.error;
    if (args.finishedAt) patch.finishedAt = args.finishedAt;
    await ctx.db.patch(args.learningRunId, patch);
  },
});

export const recordEvaluationAndDecide = internalMutation({
  args: {
    learningRunId: v.id('learningRuns'),
    workspaceId: v.id('workspaces'),
    evaluation: v.any(),
    candidateMapVersionId: v.string(),
    candidatePolicyVersionId: v.string(),
    passed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ev = args.evaluation as import('@agharta/shared').ArtifactEvaluation;
    await ctx.db.insert('artifactEvaluations', {
      workspaceId: args.workspaceId,
      learningRunId: args.learningRunId,
      evaluation: ev,
      seeds: ev.seeds,
      problemIds: ev.problemIds,
      passed: args.passed,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.learningRunId, {
      status: args.passed ? 'evaluating' : 'retained', // promoteArtifacts finalizes
      evaluation: ev,
      finishedAt: Date.now(),
    });
    if (args.passed) {
      // atomic auto-promotion (flips isActive + audit inside one mutation)
      const active = await ctx.db
        .query('conceptualMapVersions')
        .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
        .take(1);
      void active;
      // promotion mutation does the flip + audit
      const maps = await ctx.db
        .query('conceptualMapVersions')
        .withIndex('by_workspace_version', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('versionId', args.candidateMapVersionId))
        .take(1);
      const policies = await ctx.db
        .query('policyVersions')
        .withIndex('by_workspace_version', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('versionId', args.candidatePolicyVersionId))
        .take(1);
      if (maps.length === 0 || policies.length === 0) {
        throw new Error('promotion target missing');
      }
      // clear actives then set candidates (same mutation = atomic)
      const activeMaps = await ctx.db
        .query('conceptualMapVersions')
        .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
        .take(10);
      for (const doc of activeMaps) await ctx.db.patch(doc._id, { isActive: false });
      const activePolicies = await ctx.db
        .query('policyVersions')
        .withIndex('by_workspace_active', (q) => q.eq('workspaceId', args.workspaceId).eq('isActive', true))
        .take(10);
      for (const doc of activePolicies) await ctx.db.patch(doc._id, { isActive: false });
      await ctx.db.patch(maps[0]!._id, { isActive: true });
      await ctx.db.patch(policies[0]!._id, { isActive: true });
      await ctx.db.insert('promotionAudit', {
        workspaceId: args.workspaceId,
        experimentId: undefined,
        fromVersion: 'artifacts',
        toVersion: `${args.candidateMapVersionId}|${args.candidatePolicyVersionId}`,
        decision: 'auto_promote',
        by: 'engine2',
        at: Date.now(),
        rationale: (ev.reasons ?? []).join('; ').slice(0, 1000),
      });
      await ctx.db.patch(args.learningRunId, { status: 'promoted', finishedAt: Date.now() });
    }
  },
});

// ---------------------------------------------------------------------------
// credentials (BYOK) — ciphertext only
// ---------------------------------------------------------------------------

export const loadCredential = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return { provider: row.provider, encrypted: row.encrypted };
  },
});

export const loadFeedbackForExperiments = internalQuery({
  args: { workspaceId: v.id('workspaces'), experimentIds: v.array(v.id('experiments')) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('ideaFeedback')
      .withIndex('by_workspace_time', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(500);
    return rows
      .filter((r) => r.experimentId && args.experimentIds.includes(r.experimentId))
      .map((r) => ({
        experimentId: r.experimentId!,
        ideaTitle: r.ideaTitle ?? null,
        action: r.action,
      }));
  },
});
