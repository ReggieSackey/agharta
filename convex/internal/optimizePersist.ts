/**
 * Internal experiment persistence (default runtime).
 */
import { internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';

export const loadExperiment = internalQuery({
  args: { experimentId: v.id('optimizationExperiments') },
  handler: async (ctx, args) => {
    const experiment = await ctx.db.get(args.experimentId);
    if (!experiment) throw new Error('NOT_FOUND');
    const champion = await ctx.db.get(experiment.incumbentStrategyId);
    const challenger = await ctx.db.get(experiment.challengerStrategyId);
    return { experiment, champion, challenger };
  },
});

export const writeExperimentResult = internalMutation({
  args: {
    experimentId: v.id('optimizationExperiments'),
    championResult: v.any(),
    challengerResult: v.any(),
    decision: v.string(),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.experimentId, {
      championResult: args.championResult,
      challengerResult: args.challengerResult,
      decision: args.decision as 'pending_user_promotion' | 'eligible_for_promotion' | 'rejected',
      rationale: args.rationale,
    });
  },
});

