/**
 * Decision computation — the middle tier of Agharta's orchestration.
 *
 * Three forms of computation (per the V2 brief):
 *   - CREATIVE  : generative models construct and investigate ideas  (ModelAdapter)
 *   - DECISION  : classify / rank / screen cheaply                  (this file)
 *   - LEARNING  : Engine 2 updates map + policy                     (@agharta/learning)
 *
 * A DecisionProvider is a SIGNAL SOURCE, never the policy. Its outputs are
 * bounded (priorBoost clamped, screening conservative, exploration floor
 * untouchable) so Engine 2's learned knowledge remains authoritative no
 * matter which decision model is selected.
 */
import type { ProblemStructure, Mechanism, Usage } from "@agharta/shared";

// ---------------------------------------------------------------------------
// Call 1: problem-structure classification (assists Step A)
// ---------------------------------------------------------------------------

export interface ClassifyStructureInput {
  problemText: string;
  /** creative model's interpretation, if one already exists */
  objective?: string;
  knownTags?: string[];
}

export interface ClassifyStructureResult {
  structureTags: string[];
  /** 0..1 self-assessed confidence */
  confidence: number;
  providerId: string;
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Call 2: hypothesis ranking (assists Step C)
// ---------------------------------------------------------------------------

export interface RankInputMechanism {
  mechanism: Mechanism;
  /** learned-policy compatibility at call time, for context */
  policyScore: number;
  mapCompatibility: number;
  evidenceCount: number;
}

export interface RankHypothesesResult {
  /** mechanismId -> normalized priority 0..1 (higher = investigate sooner) */
  priorities: Record<string, number>;
  providerId: string;
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Call 3: candidate screening before expensive novelty judging (Step E)
// ---------------------------------------------------------------------------

export interface ScreenInputCandidate {
  candidateId: string;
  title: string;
  /** truncated proposal is the provider's responsibility */
  proposal: string;
}

export interface ScreenVerdict {
  candidateId: string;
  /** false = drop before the expensive novelty judge */
  keep: boolean;
  /** 0..1 confidence in this verdict */
  confidence: number;
  reason: string;
}

export interface ScreenCandidatesResult {
  verdicts: ScreenVerdict[];
  providerId: string;
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface DecisionProvider {
  readonly providerId: string;
  classifyStructure(
    input: ClassifyStructureInput,
  ): Promise<ClassifyStructureResult>;
  rankHypotheses(
    structure: Pick<ProblemStructure, "objective" | "structureTags">,
    mechanisms: RankInputMechanism[],
  ): Promise<RankHypothesesResult>;
  screenCandidates(
    structure: Pick<ProblemStructure, "objective" | "structureTags">,
    candidates: ScreenInputCandidate[],
  ): Promise<ScreenCandidatesResult>;
}

/** Max fraction of active candidates a decision provider may screen out. */
export const MAX_SCREEN_DROP_FRACTION = 0.3;
/** priorBoost clamp — decisions may reorder exploitation, never dominate it. */
export const PRIOR_BOOST_MIN = 0.5;
export const PRIOR_BOOST_MAX = 1.5;
