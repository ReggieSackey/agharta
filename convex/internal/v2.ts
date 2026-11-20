"use node";
/**
 * V2 Convex internals: experiment execution + Engine 2 learning + promotion.
 *
 * Flow:
 *   experiments.start (public mutation) → enqueue → runV2Experiment (internal
 *   action, Node) → persists record → schedules processV2Learning (async,
 *   idempotent) → learn() → bench champion/challenger on validation problems
 *   → gate → auto-promote or retain → activeArtifacts flipped atomically.
 */
import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { runExperiment } from '@agharta/core';
import { createFakeModel } from '@agharta/core/models';
import { adaptersFromEnv } from '@agharta/core/models.providers';
import type { ModelAdapter } from '@agharta/core/models';
import { learn, evaluatePromotionGate } from '@agharta/learning';
import { extractObservation } from '@agharta/learning';
import { VALIDATION_PROBLEMS } from '@agharta/benchmarks';
import type { ConceptualMap, SearchPolicy, ExperimentRecord, ArtifactEvaluation } from '@agharta/shared';
import { ExperimentRecordSchema } from '@agharta/shared';
import type { Id } from '../_generated/dataModel';

// ---------------------------------------------------------------------------
// artifact helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// experiment execution
// ---------------------------------------------------------------------------

export const runV2Experiment = internalAction({
  args: {
    experimentDocId: v.id('experiments'),
    workspaceId: v.id('workspaces'),
    problemId: v.id('problems'),
    problemText: v.string(),
    domain: v.string(),
    budgetPreset: v.string(),
    seed: v.number(),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    let model: ModelAdapter | null = null;
    let modelInfo: Record<string, string> = {};
    try {
      // provider resolution: BYOK credential if present, else env, else fake
      model = await resolveModel(ctx, args.workspaceId);
      modelInfo = { provider: model.providerId, model: model.modelId };
    } catch (err) {
      // fail closed with clear guidance; experiment marked failed
      await ctx.runMutation(internal.internal.v2store.persistExperimentFailure, {
        experimentDocId: args.experimentDocId,
        error: `provider resolution failed: ${errMsg(err)}`,
      });
      return;
    }

    // snapshot ACTIVE artifacts BEFORE running (atomic w.r.t. promotions).
    // ensure* seeds v0.1 on first use inside the same mutation.
    const snap = await ctx.runMutation(internal.internal.v2store.ensureActiveArtifacts, {
      workspaceId: args.workspaceId,
    });
    const map = snap.map as ConceptualMap;
    const policy = snap.policy as SearchPolicy;

    try {
      const { record } = await runExperiment(model, {
        experimentId: args.experimentDocId,
        workspaceId: args.workspaceId,
        problemId: args.problemId,
        problemText: args.problemText,
        domain: args.domain as ExperimentRecord['domain'],
        budgetPreset: args.budgetPreset as 'quick' | 'standard' | 'deep',
        map,
        policy,
        seed: args.seed,
      });
      // validate at the persistence boundary
      const parsed = ExperimentRecordSchema.parse(record);
      await ctx.runMutation(internal.internal.v2store.persistExperiment, {
        experimentDocId: args.experimentDocId,
        record: parsed,
        mapVersionId: map.versionId,
        policyVersionId: policy.versionId,
      });
      // schedule asynchronous learning (fire-and-forget, idempotent)
      await ctx.scheduler.runAfter(0, internal.internal.v2.processV2Learning, {
        workspaceId: args.workspaceId,
      });
    } catch (err) {
      await ctx.runMutation(internal.internal.v2store.persistExperimentFailure, {
        experimentDocId: args.experimentDocId,
        error: errMsg(err),
      });
      // still schedule learning — failures are signal too
      await ctx.scheduler.runAfter(0, internal.internal.v2.processV2Learning, {
        workspaceId: args.workspaceId,
      });
    }
  },
});

/** BYOK → env → fake provider resolution, all inside the action. */
async function resolveModel(ctx: any, workspaceId: Id<'workspaces'>): Promise<ModelAdapter> {
  // 1. workspace BYOK credential
  try {
    const cred = await ctx.runQuery(internal.internal.v2store.loadCredential, { workspaceId });
    if (cred) {
      const { decryptCredential } = await import('./crypto');
      const env = decryptCredential(cred.encrypted, workspaceId);
      const adapters = await adaptersFromEnv(env);
      return adapters.creative;
    }
  } catch {
    // fall through to env
  }
  // 2. server env
  const env: Record<string, string | undefined> = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    GLM_API_KEY: process.env.GLM_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL: process.env.OPENAI_COMPATIBLE_BASE_URL,
    OPENAI_COMPATIBLE_API_KEY: process.env.OPENAI_COMPATIBLE_API_KEY,
  };
  if (env.AI_PROVIDER && env.AI_PROVIDER !== 'fake') {
    const adapters = await adaptersFromEnv(env as never);
    return adapters.creative;
  }
  // 3. deterministic fake (dev/test)
  return createFakeModel();
}

// ---------------------------------------------------------------------------
// Engine 2: asynchronous, idempotent learning
// ---------------------------------------------------------------------------

export const processV2Learning = internalAction({
  args: { workspaceId: v.id('workspaces'), requestedBy: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // idempotency: claim the pending batch by input hash
    const pending = await ctx.runQuery(internal.internal.v2store.loadPendingExperiments, {
      workspaceId: args.workspaceId,
    });
    if (pending.length === 0) return { skipped: 'nothing pending' };

    const inputHash = hashOf(pending.map((p: { experimentId: string }) => p.experimentId));
    const existing = await ctx.runQuery(internal.internal.v2store.findLearningRunByHash, { inputHash });
    if (existing) return { skipped: 'already processed (idempotent)' };

    const runId = await ctx.runMutation(internal.internal.v2store.createLearningRun, {
      workspaceId: args.workspaceId,
      experimentIds: pending.map((p: { experimentId: string }) => p.experimentId),
      inputHash,
    });
    await learnAndMaybePromote(ctx, args.workspaceId, inputHash, pending, runId);
  },
});

async function learnAndMaybePromote(
  ctx: any,
  workspaceId: Id<'workspaces'>,
  inputHash: string,
  pending: Array<{ experimentId: string; record: unknown; docId: Id<'experiments'> }>,
  runDocId: Id<'learningRuns'>
) {
  try {
    await ctx.runMutation(internal.internal.v2store.updateLearningRun, {
      learningRunId: runDocId,
      status: 'fitting',
    });

    const snap = await ctx.runMutation(internal.internal.v2store.ensureActiveArtifacts, { workspaceId });
    const map = snap.map as ConceptualMap;
    const policy = snap.policy as SearchPolicy;

    const observations = pending
      .map((p) => {
        const rec = ExperimentRecordSchema.parse(p.record);
        return extractObservation(rec);
      })
      .filter(Boolean);
    if (observations.length === 0) throw new Error('no parseable observations');

    const result = learn(map, policy, observations as never, undefined, 42);
    const { map: candidateMap, policy: candidatePolicy } = result;

    await ctx.runMutation(internal.internal.v2store.insertArtifactVersions, {
      workspaceId,
      map: candidateMap,
      policy: candidatePolicy,
      isActive: false,
    });

    await ctx.runMutation(internal.internal.v2store.updateLearningRun, {
      learningRunId: runDocId,
      status: 'evaluating',
      candidateMapVersionId: candidateMap.versionId,
      candidatePolicyVersionId: candidatePolicy.versionId,
      championMapVersionId: map.versionId,
      championPolicyVersionId: policy.versionId,
    });

    // ---- champion/challenger bench on the STATIC VALIDATION fixture ----
    // (never trained on; holdout set stays untouched for periodic audits)
    const bench = VALIDATION_PROBLEMS.map((p) => ({
      id: p.id,
      text: `${p.title}. ${p.brief} Desired outcome: ${p.desiredOutcome}`,
      domain: p.domain,
    }));
    const seeds = [101, 202, 303];
    const championResults: Array<{ problemId: string; novelty: number; coherence: number }> = [];
    const challengerResults: Array<{ problemId: string; novelty: number; coherence: number }> = [];
    const model = await resolveModel(ctx, workspaceId);
    for (const p of bench) {
      for (const seed of seeds) {
        const [champ, chall] = await Promise.all([
          runExperiment(model, {
            experimentId: `bench_${inputHash.slice(0, 8)}_${p.id}_champ_${seed}`,
            workspaceId,
            problemId: p.id as never,
            problemText: p.text,
            domain: p.domain as never,
            budgetPreset: 'quick',
            map,
            policy,
            seed,
          }),
          runExperiment(model, {
            experimentId: `bench_${inputHash.slice(0, 8)}_${p.id}_chall_${seed}`,
            workspaceId,
            problemId: p.id as never,
            problemText: p.text,
            domain: p.domain as never,
            budgetPreset: 'quick',
            map: candidateMap,
            policy: candidatePolicy,
            seed,
          }),
        ]);
        championResults.push({ problemId: `${p.id}:${seed}`, ...metricsOf(champ.record) });
        challengerResults.push({ problemId: `${p.id}:${seed}`, ...metricsOf(chall.record) });
      }
    }

    const problemIds = bench.flatMap((p) => seeds.map((s) => `${p.id}:${s}`));
    const evaluation = evaluatePromotionGate({
      problemIds,
      championNovelty: championResults.map((r) => r.novelty),
      challengerNovelty: challengerResults.map((r) => r.novelty),
      championCoherence: championResults.map((r) => r.coherence),
      challengerCoherence: challengerResults.map((r) => r.coherence),
    });
    const evaluationDoc: ArtifactEvaluation = {
      id: inputHash,
      learningRunId: runDocId,
      championMetrics: {
        meanNovelty: mean(championResults.map((r) => r.novelty)),
        meanCoherence: mean(championResults.map((r) => r.coherence)),
        perProblem: championResults.map((r) => ({ problemId: r.problemId, novelty: r.novelty, coherence: r.coherence })),
      },
      challengerMetrics: {
        meanNovelty: mean(challengerResults.map((r) => r.novelty)),
        meanCoherence: mean(challengerResults.map((r) => r.coherence)),
        perProblem: challengerResults.map((r) => ({ problemId: r.problemId, novelty: r.novelty, coherence: r.coherence })),
      },
      challengerBetterProb: evaluation.challengerBetterProb,
      seeds,
      problemIds: bench.flatMap((p) => seeds.map((s) => `${p.id}:${s}`)),
      passed: evaluation.passed,
      reasons: evaluation.reasons,
    };

    await ctx.runMutation(internal.internal.v2store.recordEvaluationAndDecide, {
      learningRunId: runDocId,
      workspaceId,
      evaluation: evaluationDoc,
      candidateMapVersionId: candidateMap.versionId,
      candidatePolicyVersionId: candidatePolicy.versionId,
      passed: evaluation.passed,
    });
    await ctx.runMutation(internal.internal.v2store.markExperimentsProcessed, {
      docIds: pending.map((p: { docId: Id<'experiments'> }) => p.docId),
    });
  } catch (err) {
    if (runDocId) {
      await ctx.runMutation(internal.internal.v2store.updateLearningRun, {
        learningRunId: runDocId,
        status: 'failed',
        error: errMsg(err),
      });
    }
  }
}

/** mean novelty (composite) + coherence over final proposals of a bench run. */
function metricsOf(record: ExperimentRecord): { novelty: number; coherence: number } {
  const assessmentByCandidate = new Map(record.noveltyAssessments.map((a) => [a.candidateId, a]));
  const finals = record.finalProposals;
  if (finals.length === 0) return { novelty: 0, coherence: 0 };
  const novelties = finals.map((f) => f.novelty);
  const coherences = finals
    .map((f) => assessmentByCandidate.get(f.candidateId)?.coherence ?? 0.5)
    .filter((c) => c !== undefined);
  return {
    novelty: mean(novelties),
    coherence: mean(coherences.length ? coherences : [0.5]),
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function hashOf(parts: string[]): string {
  // fnv1a over sorted ids
  const sorted = [...parts].sort().join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 400);
  return String(err).slice(0, 400);
}
