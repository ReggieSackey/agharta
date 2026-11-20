/**
 * V2 internal MCP handlers (workspace-scoped via token auth in http.ts).
 * Rich, readable results — never opaque run ids.
 */
import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

/** Start a V2 experiment for a token-authenticated workspace. */
export const startExperiment = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    problemText: v.string(),
    domain: v.string(),
    budgetPreset: v.string(),
    /** subject to attribute the problem/experiment to (from token creator) */
    creatorSubject: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.internal.v2store.seedArtifactsIfAbsent, {
      workspaceId: args.workspaceId,
    });
    const problemId = await ctx.db.insert('problems', {
      workspaceId: args.workspaceId,
      creatorSubject: args.creatorSubject,
      title: args.problemText.slice(0, 80),
      description: args.problemText,
      desiredOutcome: '(structured by Engine 1 at interpret step)',
      domain: args.domain,
    });
    const now = Date.now();
    const experimentId = await ctx.db.insert('experiments', {
      workspaceId: args.workspaceId,
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
      workspaceId: args.workspaceId,
      problemId,
      problemText: args.problemText,
      domain: args.domain,
      budgetPreset: args.budgetPreset,
      seed: now % 2147483647,
    });
    return { experimentId: experimentId as Id<'experiments'>, problemId: problemId as Id<'problems'> };
  },
});

/** Readable experiment result for MCP: status, hypotheses, finals, learning. */
export const getExperiment = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    experimentId: v.id('experiments'),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.experimentId);
    if (!doc || doc.workspaceId !== args.workspaceId) return null;
    const rec = doc.record as import('@agharta/shared').ExperimentRecord | null;
    if (!rec) {
      return { status: doc.status, detail: 'experiment still starting; poll again shortly' };
    }
    if (rec.status === 'failed') {
      return {
        status: 'failed',
        detail: 'experiment failed',
        errors: rec.errors,
        guidance: rec.errors.some((e) => e.includes('provider'))
          ? 'Set an API key in Settings (BYOK) or ask the operator to configure AI_PROVIDER.'
          : undefined,
      };
    }
    if (rec.status !== 'completed') {
      return { status: rec.status, detail: 'experiment in progress; poll again' };
    }
    const finalist = (candidateId: string) =>
      rec.candidates.find((c) => c.id === candidateId);
    return {
      status: 'completed',
      problemInterpretation: {
        objective: rec.problemStructure.objective,
        structureTags: rec.problemStructure.structureTags,
        conventionalSolutionsToMoveBeyond: rec.problemStructure.conventionalSolutions,
      },
      hypothesesConsidered: rec.hypotheses.map((h) => ({
        mechanism: `${h.mechanismName} (${h.mechanismField})`,
        slot: h.slot,
        rationale: h.transferRationale,
        outcome: h.status,
      })),
      rejectedPaths: rec.hypotheses
        .filter((h) => h.status === 'rejected')
        .map((h) => ({ mechanism: h.mechanismName, reason: h.rejectionReason })),
      finalProposals: rec.finalProposals.map((f) => {
        const c = finalist(f.candidateId);
        return {
          title: f.title,
          proposal: f.proposal,
          mechanismField: f.mechanismField,
          novelty: f.novelty,
          whyItDiffers: c?.differenceFromConventional,
          transferStory: c?.transferStory,
          howToExplore: c?.explorationStep,
          assumptions: c?.assumptions,
          limitations: c?.limitations,
        };
      }),
      learningPlanned: true,
      usage: rec.usage,
      artifactsUsed: { map: rec.mapVersionId, policy: rec.policyVersionId },
    };
  },
});

/** Learning summary for MCP: active versions, recent runs, honest metrics. */
export const learningSummaryV2 = internalMutation({
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
    const runs = await ctx.db
      .query('learningRuns')
      .withIndex('by_workspace_created', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(10);
    const edges = (mapDoc?.artifact as { edges?: unknown[] } | undefined)?.edges ?? [];
    return {
      activeMap: mapDoc ? { version: mapDoc.version, learnedEdges: edges.length } : null,
      activePolicy: policyDoc
        ? {
            version: policyDoc.version,
            explorationFloor: (policyDoc.artifact as { explorationFloor?: number }).explorationFloor,
            learnedFeatureWeights: Object.keys(
              (policyDoc.artifact as { compatWeights?: Record<string, number> }).compatWeights ?? {}
            ).length,
          }
        : null,
      recentLearningRuns: runs.map((r) => ({
        status: r.status,
        candidatePolicy: r.candidatePolicyVersionId,
        decision:
          r.evaluation
            ? {
                passed: (r.evaluation as { passed?: boolean }).passed,
                challengerBetterProb: (r.evaluation as { challengerBetterProb?: number }).challengerBetterProb,
                reasons: (r.evaluation as { reasons?: string[] }).reasons,
              }
            : null,
        error: r.error,
        createdAt: r.createdAt,
      })),
      note: 'Metrics reflect automated evaluation only. No learning gain is claimed unless a challenger passed the promotion gate.',
    };
  },
});

/** Human-tier feedback on a final proposal (V2). Joins by experiment+title. */
export const submitFeedbackV2 = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    experimentId: v.id('experiments'),
    ideaTitle: v.string(),
    action: v.string(),
    reason: v.optional(v.string()),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.experimentId);
    if (!doc || doc.workspaceId !== args.workspaceId) return { ok: false, error: 'experiment not found' };
    const rec = doc.record as import('@agharta/shared').ExperimentRecord | null;
    const final = rec?.finalProposals.find((f) => f.title === args.ideaTitle);
    if (!final) {
      return {
        ok: false,
        error: 'no final proposal with that title',
        availableTitles: rec?.finalProposals.map((f) => f.title) ?? [],
      };
    }
    await ctx.db.insert('ideaFeedback', {
      workspaceId: args.workspaceId,
      experimentId: args.experimentId,
      ideaTitle: final.title,
      actorSubject: 'mcp-user',
      action: args.action,
      reason: args.reason,
      evidence: args.evidence,
      verificationStatus: 'self_reported',
    });
    return {
      ok: true,
      recorded: { experimentId: args.experimentId, ideaTitle: final.title, action: args.action },
      note: 'Human-tier evidence recorded; it modulates coherence weighting in future learning runs. Novelty learning remains driven by automated evaluation.',
    };
  },
});
