/**
 * Algorithmic decision provider — decisions computed directly from the
 * LEARNED policy + conceptual map snapshot. Zero model calls, zero cost,
 * always available. This is the default decision tier and the fallback for
 * every other provider (per brief: "system remains functional without Jev").
 *
 * Everything it computes is auditable: the compat() features and weights ARE
 * the ranking; there is no hidden model opinion.
 */
import type {
  ProblemStructure,
  Mechanism,
  SearchPolicy,
  ConceptualMap,
  Usage,
} from "@agharta/shared";
import { EMPTY_USAGE } from "@agharta/shared";
import { compat } from "@agharta/learning";
import type {
  DecisionProvider,
  ClassifyStructureInput,
  ClassifyStructureResult,
  RankInputMechanism,
  RankHypothesesResult,
  ScreenInputCandidate,
  ScreenCandidatesResult,
  ScreenVerdict,
} from "./types";

function maxMinNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  if (hi - lo < 1e-9) return scores.map(() => 0.5);
  return scores.map((s) => (s - lo) / (hi - lo));
}

/** Evidence-weighted map-edge posterior mean for (tags → mechanism). */
export function mapEdgeMean(
  map: ConceptualMap,
  structureTags: string[],
  mechanismId: string,
): { compatibility: number; evidenceCount: number } {
  let compatSum = 0;
  let compatN = 0;
  let evidenceCount = 0;
  for (const e of map.edges) {
    if (
      e.to === mechanismId &&
      structureTags.some((t) => e.from === `tag:${t}`)
    ) {
      compatSum += e.compatibility;
      compatN += 1;
      evidenceCount += e.automatedEvidenceCount + e.humanEvidenceCount;
    }
  }
  return {
    compatibility: compatN > 0 ? compatSum / compatN : 0.5,
    evidenceCount,
  };
}

/**
 * Pure function: rank mechanisms under the learned policy (compat weights +
 * field posteriors) blended with map-edge evidence. Used by the decider and
 * directly by benchmarks/tests.
 */
export function policyRankScores(
  structure: Pick<ProblemStructure, "objective" | "structureTags">,
  mechanisms: RankInputMechanism[],
  policy: SearchPolicy,
): Record<string, number> {
  const blended = mechanisms.map((m) => {
    const learned = compat(structure as ProblemStructure, m.mechanism, policy);
    const evidenceWeight = Math.min(1, m.evidenceCount / 5);
    return (
      (learned + m.mapCompatibility * evidenceWeight) / (1 + evidenceWeight)
    );
  });
  const normalized = maxMinNormalize(blended);
  const out: Record<string, number> = {};
  mechanisms.forEach(
    (m, i) => (out[m.mechanism.id] = Number(normalized[i]!.toFixed(4))),
  );
  return out;
}

export interface PolicyDeciderOptions {
  /** active policy snapshot (decisions are functions of the LEARNED state) */
  policy: SearchPolicy;
  /** active map snapshot */
  map?: ConceptualMap;
  /** open tag vocabulary, for the lexical classify assist */
  knownTags?: string[];
}

export function createPolicyDecider(
  opts: PolicyDeciderOptions,
): DecisionProvider {
  const providerId = "policy-algorithmic-v1";
  return {
    providerId,

    async classifyStructure(
      input: ClassifyStructureInput,
    ): Promise<ClassifyStructureResult> {
      // Lexical tie-break against the open tag vocabulary: a cheap assist to
      // the creative model's interpretation, NOT a replacement for it.
      const tags = input.knownTags ?? opts.knownTags ?? [];
      const text =
        `${input.problemText} ${input.objective ?? ""}`.toLowerCase();
      const matched = new Set<string>();
      for (const tag of tags) {
        if (text.includes(tag.replace(/_/g, " ")) || text.includes(tag)) {
          matched.add(tag);
        }
      }
      return {
        structureTags: [...matched].slice(0, 6),
        confidence: matched.size > 0 ? 0.4 : 0.1,
        providerId,
        usage: { ...EMPTY_USAGE },
      };
    },

    async rankHypotheses(
      structure: Pick<ProblemStructure, "objective" | "structureTags">,
      mechanisms: RankInputMechanism[],
    ): Promise<RankHypothesesResult> {
      return {
        priorities: policyRankScores(structure, mechanisms, opts.policy),
        providerId,
        usage: { ...EMPTY_USAGE },
      };
    },

    async screenCandidates(
      structure: Pick<ProblemStructure, "objective" | "structureTags">,
      candidates: ScreenInputCandidate[],
    ): Promise<ScreenCandidatesResult> {
      // Conservative lexical relevance screen: relevance is a THRESHOLD
      // requirement, not the objective. Only drop when a candidate shares no
      // vocabulary with the problem at all (likely off-topic generation).
      const vocab = new Set(
        `${structure.objective} ${structure.structureTags.join(" ")}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 4),
      );
      const verdicts: ScreenVerdict[] = candidates.map((c) => {
        const words = `${c.title} ${c.proposal}`
          .toLowerCase()
          .split(/[^a-z0-9]+/);
        const overlap = words.filter((w) => vocab.has(w)).length;
        const distinct = new Set(words.filter((w) => w.length > 4)).size || 1;
        const denom = Math.min(distinct, 40);
        const ratio = overlap / denom;
        const keep = ratio > 0.02;
        return {
          candidateId: c.candidateId,
          keep,
          confidence: 0.3,
          reason: keep
            ? `lexical overlap ${overlap}/${denom} — retained for novelty judging`
            : `no lexical overlap with problem vocabulary (${overlap} shared tokens) — likely off-topic`,
        };
      });
      return { verdicts, providerId, usage: { ...EMPTY_USAGE } };
    },
  };
}
