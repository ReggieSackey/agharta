/**
 * Internal persistence mutations for exploration execution.
 * Default Convex runtime (queries/mutations can't live in 'use node' files).
 */
import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import type { Id, Doc } from '../_generated/dataModel';
import type { Idea, Evaluation } from '@agharta/shared';

export const loadExplorationContext = internalQuery({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId);
    if (!ex) throw new Error('NOT_FOUND');
    const problem = await ctx.db.get(ex.problemId);
    const strategy = await ctx.db.get(ex.strategyId);
    return { ex, problem, strategy };
  },
});

export const persistIdeaInternal = internalMutation({
  args: {
    explorationId: v.id('explorations'),
    workspaceId: v.id('workspaces'),
    idea: v.any(),
    evaluation: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    const idea = args.idea as Idea;
    const id = await ctx.db.insert('ideas', {
      workspaceId: args.workspaceId,
      explorationId: args.explorationId,
      title: idea.title,
      intervention: idea.intervention,
      causalMechanism: idea.causalMechanism,
      assumptions: idea.assumptions,
      failureModes: idea.failureModes,
      proposedTest: idea.proposedTest,
      operatorId: idea.operatorId,
      parentIds: idea.parentIds,
      sourceConceptIds: idea.sourceConceptIds,
      mechanismId: idea.mechanismId,
      generation: idea.generation,
      invertedConstraint: idea.invertedConstraint,
      survivedRepair: idea.survivedRepair,
      selectionState: 'unknown',
    });
    if (args.evaluation) {
      const e = args.evaluation as Evaluation;
      await ctx.db.insert('evaluations', {
        workspaceId: args.workspaceId,
        ideaId: id,
        judgeType: 'model-judge',
        judgeModel: e.evaluator,
        judgeVersion: e.evaluatorVersion,
        originality: e.originality,
        usefulness: e.usefulness,
        feasibility: e.feasibility,
        structuralValidity: e.structuralValidity,
        uncertainty: e.uncertainty,
        rationale: e.justification,
        evidenceTier: 'automated_proxy',
      });
    }
    return id;
  },
});

export const persistEdgeInternal = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    parentId: v.string(),
    childId: v.string(),
    relation: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('ideaEdges', {
      workspaceId: args.workspaceId,
      parentIdeaId: args.parentId,
      childIdeaId: args.childId,
      relation: args.relation as 'mutation' | 'recombination' | 'refinement' | 'analogy_transfer',
    });
  },
});

export const persistIdeaSourceInternal = internalMutation({
  args: { workspaceId: v.id('workspaces'), ideaId: v.id('ideas'), slug: v.string(), distance: v.optional(v.number()), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.insert('ideaSources', {
      workspaceId: args.workspaceId,
      ideaId: args.ideaId,
      sourceConceptSlug: args.slug,
      distance: args.distance,
      mappingNotes: args.notes,
    });
  },
});

export const recordInvocationInternal = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    explorationId: v.id('explorations'),
    operator: v.string(),
    usage: v.any(),
    meta: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('operatorInvocations', {
      workspaceId: args.workspaceId,
      explorationId: args.explorationId,
      operator: args.operator,
      contextHash: args.meta.contextHash,
      modelId: args.meta.modelId,
      promptVersion: args.meta.promptVersion,
      outputsGenerated: args.meta.outputsGenerated,
      usage: args.usage,
    });
  },
});

export const reportProgressInternal = internalMutation({
  args: { explorationId: v.id('explorations'), progress: v.number(), stage: v.string() },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId);
    if (!ex || ex.status === 'cancelled') return;
    await ctx.db.patch(args.explorationId, { progress: args.progress, stage: args.stage, status: 'running' });
  },
});

export const persistEvaluationInternal = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    evaluation: v.any(),
  },
  handler: async (ctx, args) => {
    const e = args.evaluation as Evaluation;
    await ctx.db.insert('evaluations', {
      workspaceId: args.workspaceId,
      ideaId: e.ideaId as Id<'ideas'>,
      judgeType: 'model-judge',
      judgeModel: e.evaluator,
      judgeVersion: e.evaluatorVersion,
      originality: e.originality,
      usefulness: e.usefulness,
      feasibility: e.feasibility,
      structuralValidity: e.structuralValidity,
      uncertainty: e.uncertainty,
      rationale: e.justification,
      evidenceTier: 'automated_proxy',
    });
  },
});

export const finalizeExplorationInternal = internalMutation({
  args: {
    explorationId: v.id('explorations'),
    status: v.string(),
    usage: v.any(),
    summary: v.any(),
    recommendations: v.any(),
    mechanisms: v.any(),
  },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId) as Doc<'explorations'> | null;
    // idempotent: never double-finalize
    if (!ex || ex.status === 'completed' || ex.status === 'failed' || ex.status === 'cancelled') {
      return { alreadyFinal: true };
    }
    await ctx.db.patch(args.explorationId, {
      status: args.status as 'completed' | 'failed' | 'cancelled',
      usage: args.usage,
      summary: { recommendations: args.recommendations, mechanisms: args.mechanisms },
      finishedAt: Date.now(),
      progress: 1,
      stage: args.status,
    });
    // mark selected ideas
    for (const rec of args.recommendations as Array<{ ideaId: string }>) {
      const idea = await ctx.db.get(rec.ideaId as Id<'ideas'>);
      if (idea && idea.selectionState === 'unknown') {
        await ctx.db.patch(rec.ideaId as Id<'ideas'>, { selectionState: 'selected' });
      }
    }
    return { alreadyFinal: false };
  },
});

export const appendErrorInternal = internalMutation({
  args: { explorationId: v.id('explorations'), message: v.string() },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId);
    if (!ex) return;
    const errors = [...(ex.errors ?? []), args.message].slice(-20);
    await ctx.db.patch(args.explorationId, { errors });
  },
});

// ---------------------------------------------------------------------------
// The durable action
// ---------------------------------------------------------------------------

/** Tiny status probe for cancellation checks. */
export const loadExplorationStatus = internalQuery({
  args: { explorationId: v.id('explorations') },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.explorationId);
    return ex?.status ?? null;
  },
});

