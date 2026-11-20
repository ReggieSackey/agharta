/**
 * Optional Jev (TypeSafe AI System One) decision provider.
 *
 * API shape verified against current official docs (2026-11):
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <key>
 *   { model: "jev-latest", state: string|object, questions: {
 *       qid: { type: "choice"|"score"|"noul", instructions, criteria } } }
 *   → { answers: { qid: { choice|score|noul, probabilities, confidence } },
 *       usage: { input_tokens, output_tokens } }
 *
 * Per the brief, Jev is:
 *   - optional (createJevDecider throws without JEV_API_KEY → callers fall
 *     back to the policy decider),
 *   - a decision SIGNAL, never the learned policy: its rank output only
 *     modulates the learned prior within [PRIOR_BOOST_MIN, PRIOR_BOOST_MAX],
 *   - unable to touch the exploration floor or slot structure.
 */
import type { ProblemStructure, Usage } from "@agharta/shared";
import { EMPTY_USAGE } from "@agharta/shared";
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
import { PRIOR_BOOST_MIN, PRIOR_BOOST_MAX } from "./types";
import { policyRankScores } from "./policyDecider";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_INPUT_USD_PER_MTOK = 0.042;

interface JevQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: unknown;
}
interface JevRequest {
  model: string;
  state: string | object;
  questions: Record<string, JevQuestion>;
}
interface JevAnswerBase {
  confidence?: number;
}
interface JevChoiceAnswer extends JevAnswerBase {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
}
interface JevScoreAnswer extends JevAnswerBase {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
}
interface JevNoulAnswer extends JevAnswerBase {
  type: "noul";
  noul: number;
}
type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;
interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevDeciderOptions {
  apiKey: string;
  model?: string;
  /** active policy snapshot — Jev modulates, never replaces, the learned rank */
  policy: Parameters<typeof policyRankScores>[2];
  /** fetch override for tests (deterministic fixtures, no network) */
  fetchImpl?: typeof fetch;
  /** timeout per call */
  timeoutMs?: number;
  maxRetries?: number;
}

function usageFrom(
  resp: JevResponse | null,
  calls: number,
  wallClockMs: number,
): Usage {
  const inputTokens = resp?.usage?.input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens: resp?.usage?.output_tokens ?? 0,
    costUsd: Number(((inputTokens / 1e6) * JEV_INPUT_USD_PER_MTOK).toFixed(6)),
    modelCalls: calls,
    wallClockMs,
  };
}

async function callJev(
  req: JevRequest,
  opts: Required<
    Pick<JevDeciderOptions, "apiKey" | "model" | "timeoutMs" | "maxRetries">
  > & {
    fetchImpl: typeof fetch;
  },
): Promise<{ resp: JevResponse; wallClockMs: number }> {
  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await opts.fetchImpl(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `jev ${req.model}: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as JevResponse;
      return { resp: json, wallClockMs: Date.now() - started };
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `jev call failed after ${opts.maxRetries} attempts: ${String(lastErr).slice(0, 200)}`,
  );
}

/**
 * Map Jev Score answers to a 0..1 priority per mechanism: one request, one
 * Score question per mechanism (all evaluated in parallel against the state).
 * The returned priorities then only MODULATE the learned rank.
 */
export function createJevDecider(opts: JevDeciderOptions): DecisionProvider {
  if (!opts.apiKey) throw new Error("createJevDecider requires JEV_API_KEY");
  const model = opts.model ?? "jev-latest";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 2;
  const providerId = `jev:${model}`;

  return {
    providerId,

    async classifyStructure(
      input: ClassifyStructureInput,
    ): Promise<ClassifyStructureResult> {
      // Noul battery: one yes/no question per candidate tag; tags with noul
      // above threshold become the classification assist.
      const tags = (input.knownTags ?? []).slice(0, 12);
      if (tags.length === 0) {
        return {
          structureTags: [],
          confidence: 0,
          providerId,
          usage: { ...EMPTY_USAGE },
        };
      }
      const questions: Record<string, JevQuestion> = {};
      tags.forEach((tag, i) => {
        questions[`tag_${i}`] = {
          type: "noul",
          instructions: `Is the problem structurally a "${tag.replace(/_/g, " ")}" problem?`,
        };
      });
      const { resp, wallClockMs } = await callJev(
        { model, state: input.problemText, questions },
        { apiKey: opts.apiKey, model, timeoutMs, maxRetries, fetchImpl },
      );
      const picked: string[] = [];
      let confSum = 0;
      tags.forEach((tag, i) => {
        const a = resp.answers?.[`tag_${i}`];
        if (a?.type === "noul" && a.noul >= 0.6) {
          picked.push(tag);
          confSum += a.confidence ?? 0.5;
        }
      });
      return {
        structureTags: picked,
        confidence:
          picked.length > 0 ? Math.min(1, confSum / picked.length) : 0.1,
        providerId,
        usage: usageFrom(resp, 1, wallClockMs),
      };
    },

    async rankHypotheses(
      structure: Pick<ProblemStructure, "objective" | "structureTags">,
      mechanisms: RankInputMechanism[],
    ): Promise<RankHypothesesResult> {
      if (mechanisms.length === 0) {
        return { priorities: {}, providerId, usage: { ...EMPTY_USAGE } };
      }
      // learned rank is the baseline — Jev may only modulate within bounds
      const learned = policyRankScores(structure, mechanisms, opts.policy);
      const state = {
        objective: structure.objective,
        structureTags: structure.structureTags,
        candidates: mechanisms.map((m) => ({
          id: m.mechanism.id,
          field: m.mechanism.field,
          name: m.mechanism.name,
          mechanism: m.mechanism.mechanism.slice(0, 300),
          appliesWhen: m.mechanism.appliesWhen.slice(0, 200),
        })),
      };
      const questions: Record<string, JevQuestion> = {};
      mechanisms.forEach((m, i) => {
        questions[`rank_${i}`] = {
          type: "score",
          instructions: `How promising is candidate "${m.mechanism.id}" (${m.mechanism.name}, from ${m.mechanism.field}) as a source of a genuinely novel yet coherent approach to this problem? 0 = weak, 4 = exceptional promise.`,
          criteria: [
            "Weak or irrelevant: the mechanism does not plausibly transfer to this problem",
            "Marginal: superficial resemblance only; unlikely to change the approach",
            "Moderate: real structural overlap; could seed a recognizably different approach",
            "Strong: deep structural match; likely to yield an approach the problem owner has not considered",
            "Exceptional: the mechanism reinterprets the core of the problem in a new frame",
          ],
        };
      });
      const { resp, wallClockMs } = await callJev(
        { model, state, questions },
        { apiKey: opts.apiKey, model, timeoutMs, maxRetries, fetchImpl },
      );
      const priorities: Record<string, number> = {};
      mechanisms.forEach((m, i) => {
        const a = resp.answers?.[`rank_${i}`];
        const jevScore =
          a?.type === "score" && Number.isFinite(a.score) ? a.score : null;
        const base = learned[m.mechanism.id] ?? 0.5;
        if (jevScore === null) {
          priorities[m.mechanism.id] = base; // fallback: learned rank only
          return;
        }
        const normalized = Math.max(0, Math.min(1, jevScore / 4));
        // Map the normalized Jev score 0..1 → multiplier [PRIOR_BOOST_MIN,
        // PRIOR_BOOST_MAX], shrunk toward 1.0 (no effect) when confidence is low.
        const raw =
          PRIOR_BOOST_MIN + normalized * (PRIOR_BOOST_MAX - PRIOR_BOOST_MIN);
        const shrunk =
          1 + (raw - 1) * Math.min(1, (a?.confidence ?? 0.5) * 1.25);
        priorities[m.mechanism.id] = Math.max(0, Math.min(1, base * shrunk));
      });
      return { priorities, providerId, usage: usageFrom(resp, 1, wallClockMs) };
    },

    async screenCandidates(
      structure: Pick<ProblemStructure, "objective" | "structureTags">,
      candidates: ScreenInputCandidate[],
    ): Promise<ScreenCandidatesResult> {
      if (candidates.length === 0) {
        return { verdicts: [], providerId, usage: { ...EMPTY_USAGE } };
      }
      const state = {
        objective: structure.objective,
        structureTags: structure.structureTags,
        candidates: candidates.map((c) => ({
          id: c.candidateId,
          title: c.title,
          proposal: c.proposal.slice(0, 600),
        })),
      };
      const questions: Record<string, JevQuestion> = {};
      candidates.forEach((_, i) => {
        questions[`screen_${i}`] = {
          type: "noul",
          instructions:
            "Is this candidate on-topic for the problem — related enough that a detailed novelty assessment would not be wasted? (Answer false for clearly off-topic or nonsensical candidates.)",
        };
      });
      const { resp, wallClockMs } = await callJev(
        { model, state, questions },
        { apiKey: opts.apiKey, model, timeoutMs, maxRetries, fetchImpl },
      );
      const verdicts: ScreenVerdict[] = candidates.map((c, i) => {
        const a = resp.answers?.[`screen_${i}`];
        if (a?.type !== "noul") {
          return {
            candidateId: c.candidateId,
            keep: true,
            confidence: 0,
            reason: "jev answer missing — conservative keep",
          };
        }
        const keep = a.noul >= 0.35;
        return {
          candidateId: c.candidateId,
          keep,
          confidence: a.confidence ?? 0.5,
          reason: keep
            ? `on-topic (noul ${a.noul.toFixed(2)}) — retained`
            : `off-topic (noul ${a.noul.toFixed(2)}) — dropped before expensive judging`,
        };
      });
      return { verdicts, providerId, usage: usageFrom(resp, 1, wallClockMs) };
    },
  };
}
