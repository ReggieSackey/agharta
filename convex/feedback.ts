/**
 * Feedback: append-only events + idempotent derived-stats recomputation.
 */
import { mutation, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireIdeaAccess } from './auth';
import { FeedbackEventSchema } from '@agharta/shared';

/** feedback.submit — validates, appends event, updates idea state, recomputes operator stats. */
export const submit = mutation({
  args: {
    ideaId: v.id('ideas'),
    action: v.string(),
    reason: v.optional(v.string()),
    evidence: v.optional(v.string()),
    outcomeMetric: v.optional(v.string()),
    confidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { idea, subject } = await requireIdeaAccess(ctx, args.ideaId);
    const input = FeedbackEventSchema.parse({
      ideaId: args.ideaId,
      action: args.action,
      reason: args.reason,
      evidence: args.evidence,
      outcomeMetric: args.outcomeMetric,
      confidence: args.confidence,
    });

    // append-only event
    const eventId = await ctx.db.insert('ideaFeedback', {
      workspaceId: idea.workspaceId,
      ideaId: args.ideaId,
      actorSubject: subject,
      action: input.action,
      reason: input.reason,
      evidence: input.evidence,
      outcomeMetric: input.outcomeMetric,
      confidence: input.confidence,
      // user self-report is never experimentally verified by default
      verificationStatus: 'self_reported',
    });

    // derived idea state
    await ctx.db.patch(args.ideaId, { selectionState: input.action });

    // idempotent async recomputation of operator stats
    ctx.scheduler.runAfter(0, internal.internal.learning.recomputeOperatorStats, {
      workspaceId: idea.workspaceId,
    });
    return { eventId, newStatus: input.action };
  },
});

export const listForIdea = mutation({
  args: { ideaId: v.id('ideas') },
  handler: async (ctx, args) => {
    await requireIdeaAccess(ctx, args.ideaId);
    return ctx.db.query('ideaFeedback').withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId)).take(20);
  },
});
