/**
 * Model-judge adapter: independent rubric scoring with duplicate detection.
 * Uses a DIFFERENT prompt role than the generators (never the creative
 * system preamble) and, when budget allows, a different model family.
 */
import type { Evaluation, Idea, Usage } from '@agharta/shared';
import { EMPTY_USAGE, addUsage, lexicalSimilarity, hashEmbedding, cosineSimilarity } from '@agharta/shared';
import { z } from 'zod';
import type { ModelAdapter } from '@agharta/core';
import { rubricPrompt, JUDGE_VERSION } from './rubrics';

const JudgeOutputSchema = z.object({
  originality: z.number().int().min(1).max(5),
  usefulness: z.number().int().min(1).max(5),
  feasibility: z.number().int().min(1).max(5),
  structuralValidity: z.number().int().min(1).max(5).optional(),
  uncertainty: z.number().min(0).max(1),
  justification: z.string().min(1).max(4000),
  duplicateOf: z.string().nullable().optional(),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeOptions {
  evaluator: string;
  /** similarity above which the judge is asked about duplication */
  duplicateThreshold?: number;
}

export class ModelJudge {
  constructor(
    private readonly model: ModelAdapter,
    private readonly opts: JudgeOptions = { evaluator: 'model-judge' }
  ) {}

  get id() { return this.opts.evaluator; }
  get version() { return `${JUDGE_VERSION}/${this.model.providerId}:${this.model.modelId}`; }

  async evaluate(idea: Idea, allIdeas: Idea[]): Promise<{ evaluation: Evaluation; usage: Usage; duplicateOfId?: string }> {
    const siblings = allIdeas
      .filter((i) => i.id !== idea.id)
      .slice(0, 40)
      .map((i) => `- [${i.id}] ${i.title}: ${i.causalMechanism.slice(0, 160)}`)
      .join('\n');
    const res = await this.model.generate(
      {
        requestId: `judge:${idea.id}`,
        operator: 'judge',
        system: rubricPrompt(),
        prompt: `IDEA UNDER REVIEW:\ntitle: ${idea.title}\nintervention: ${idea.intervention}\nmechanism: ${idea.causalMechanism}\nassumptions: ${idea.assumptions.join('; ')}\nproposed test: ${idea.proposedTest}\noperator: ${idea.operatorId}${idea.sourceConceptIds.length ? `\nsource concepts: ${idea.sourceConceptIds.join(', ')}` : ''}\n\nSIBLING IDEAS (for duplication check):\n${siblings || '(none)'}`,
      },
      JudgeOutputSchema
    );
    let evaluation: Evaluation = {
      ideaId: idea.id,
      evaluator: this.opts.evaluator,
      evaluatorVersion: this.version,
      originality: res.data.originality,
      usefulness: res.data.usefulness,
      feasibility: res.data.feasibility,
      structuralValidity: idea.operatorId === 'analogy' ? res.data.structuralValidity ?? 3 : undefined,
      uncertainty: res.data.uncertainty,
      justification: res.data.justification,
      evidenceKind: 'automated_proxy',
    };
    // deterministic duplicate cross-check (embeddings or lexical fallback)
    const dup = this.findDuplicate(idea, allIdeas, this.opts.duplicateThreshold ?? 0.85);
    if (dup) {
      evaluation = {
        ...evaluation,
        justification: `${evaluation.justification}\n[deterministic-check] near-duplicate of ${dup.id} flagged.`,
        originality: Math.min(evaluation.originality, 2),
      };
    }
    return { evaluation, usage: res.usage, duplicateOfId: dup?.id };
  }

  private findDuplicate(idea: Idea, all: Idea[], threshold: number): Idea | undefined {
    let best: { idea: Idea; sim: number } | undefined;
    for (const other of all) {
      if (other.id === idea.id) continue;
      const text = (i: Idea) => `${i.title}\n${i.intervention}\n${i.causalMechanism}`;
      const sim = Math.max(
        cosineSimilarity(hashEmbedding(text(idea)), hashEmbedding(text(other))),
        lexicalSimilarity(text(idea), text(other))
      );
      if (!best || sim > best.sim) best = { idea: other, sim };
    }
    return best && best.sim >= threshold ? best.idea : undefined;
  }
}

/** Judge for the engine port — evaluates with sibling context and persists nothing. */
export function engineJudgeAdapter(judge: ModelJudge): {
  evaluate(idea: Idea, allIdeas: Idea[]): Promise<{ evaluation: Evaluation; usage: Usage }>;
} {
  return {
    evaluate: async (idea, allIdeas) => {
      const { evaluation, usage } = await judge.evaluate(idea, allIdeas);
      return { evaluation, usage };
    },
  };
}
