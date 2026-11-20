/**
 * V2 Engine 1 — model-boundary output schemas.
 * The fake model synthesizes valid payloads for every one of these so the
 * whole search runs deterministically without credentials.
 */
import { z } from 'zod';

// Step A: problem interpretation
export const InterpretationOutputSchema = z.object({
  objective: z.string().trim().min(1).max(2000),
  structureTags: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  actors: z.array(z.string().trim().min(1).max(200)).max(12),
  incentives: z.array(z.string().trim().min(1).max(300)).max(12),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20),
  resources: z.array(z.string().trim().min(1).max(300)).max(12),
  obstacles: z.array(z.string().trim().min(1).max(300)).max(12),
  conventionalSolutions: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  previouslyTried: z.array(z.string().trim().min(1).max(500)).max(20),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(10),
  interpretationConfidence: z.number().int().min(1).max(5),
});

// Step C: hypothesis formation (per candidate mechanism the model fills the rationale;
// selection itself is done by the learned policy in code, not by the model)
export const HypothesisDraftSchema = z.object({
  mechanismId: z.string().min(1),
  transferRationale: z.string().trim().min(1).max(2000),
  structuralMapping: z.array(
    z.object({
      problemFeature: z.string().trim().min(1).max(300),
      mechanismElement: z.string().trim().min(1).max(300),
      mappingConfidence: z.number().min(0).max(1),
    })
  ).min(1).max(8),
  expectedProduce: z.string().trim().min(1).max(1000),
  invalidatingAssumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
});
export const HypothesisBatchSchema = z.object({
  hypotheses: z.array(HypothesisDraftSchema).min(1).max(12),
});

// Step D: investigation of ONE hypothesis
export const InvestigationOutputSchema = z.object({
  /** the causal principle underlying the source mechanism */
  causalPrinciple: z.string().trim().min(1).max(2000),
  candidates: z.array(
    z.object({
      title: z.string().trim().min(1).max(200),
      proposal: z.string().trim().min(1).max(4000),
      transferStory: z.string().trim().min(1).max(4000),
      differenceFromConventional: z.string().trim().min(1).max(2000),
      explorationStep: z.string().trim().min(1).max(2000),
      assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
      limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
    })
  ).min(1).max(5),
  /** self-critique: did the transfer survive assumption attacks? */
  critique: z.object({
    survived: z.boolean(),
    invalidAssumptions: z.array(z.string().trim().min(1).max(500)).max(8),
    coherenceNotes: z.string().trim().min(1).max(2000),
  }),
});

// Step D2: recombination of survivors across hypotheses
export const RecombinationOutputSchema = z.object({
  candidates: z.array(
    z.object({
      title: z.string().trim().min(1).max(200),
      proposal: z.string().trim().min(1).max(4000),
      transferStory: z.string().trim().min(1).max(4000),
      differenceFromConventional: z.string().trim().min(1).max(2000),
      explorationStep: z.string().trim().min(1).max(2000),
      assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
      limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
      parentHypothesisIds: z.array(z.string().min(1)).min(2).max(3),
    })
  ).min(1).max(3),
});

// Step E: novelty assessment (per candidate; multiple reference points)
export const NoveltyJudgeOutputSchema = z.object({
  vsConventional: z.number().int().min(1).max(5),
  vsSiblings: z.number().int().min(1).max(5),
  transferDistance: z.number().int().min(1).max(5),
  substantiveDifference: z.number().int().min(1).max(5),
  coherence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  justification: z.string().trim().min(1).max(2000),
  /** sibling duplicate flag: names a sibling candidate id or null */
  duplicateOf: z.string().nullable(),
});
