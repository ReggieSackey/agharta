/**
 * Decision-tier tests:
 *   1. policy decider — rank IS the learned policy (auditable, zero-cost)
 *   2. jev adapter — request shape + response parsing against documented API
 *      fixtures (no network); boost clamps; fallback on missing answers
 *   3. resolver — no JEV_API_KEY → policy decider; with key → jev
 *   4. withFallback — Jev error mid-run → policy answers, failure recorded
 *   5. engine integration — screening bounded, accounting recorded
 */
import { describe, it, expect } from "vitest";
import { createPolicyDecider, policyRankScores, mapEdgeMean } from "./index";
import { createJevDecider } from "./jevDecider";
import { resolveDecisionProvider, withFallback } from "./index";
import { initialConceptualMap, initialSearchPolicy } from "@agharta/learning";
import { SEED_MECHANISMS } from "@agharta/shared";
import type { SearchPolicy } from "@agharta/shared";
import { runExperiment } from "../search/engine2";
import { createFakeModel } from "../models";

const structure = {
  objective: "Find a genuinely unconventional job-search approach",
  structureTags: ["signaling", "matching", "search"],
};

const mech = SEED_MECHANISMS.slice(0, 5).map((m) => ({
  mechanism: m,
  policyScore: 0.5,
  mapCompatibility: 0.5,
  evidenceCount: 0,
}));

describe("policy decider (algorithmic tier)", () => {
  it("ranks purely from the learned policy — zero model calls, auditable", async () => {
    const policy = initialSearchPolicy();
    const d = createPolicyDecider({
      policy,
      knownTags: ["signaling", "search"],
    });
    const res = await d.rankHypotheses(structure, mech);
    expect(res.providerId).toBe("policy-algorithmic-v1");
    expect(res.usage.modelCalls).toBe(0);
    expect(res.usage.costUsd).toBe(0);
    expect(Object.keys(res.priorities)).toHaveLength(5);
    // deterministic
    const res2 = await d.rankHypotheses(structure, mech);
    expect(res2.priorities).toEqual(res.priorities);
  });

  it("changes ranking when the learned policy changes (learning moves decisions)", async () => {
    const base = initialSearchPolicy();
    // construct a policy that loves immunology for signaling problems
    const learned: SearchPolicy = {
      ...base,
      compatWeights: { ...base.compatWeights, "tf:signaling|immunology": 4 },
    };
    const plain = policyRankScores(structure, mech, base);
    const learnedRank = policyRankScores(structure, mech, learned);
    const immu = mech.find((m) => m.mechanism.field === "immunology")!.mechanism
      .id;
    // immunology must rank at/above its plain rank, and strictly above 0 in learned
    expect(learnedRank[immu]).toBeGreaterThan(plain[immu]);
    // and be the top mechanism under the learned policy
    const top = Object.entries(learnedRank).sort((a, b) => b[1] - a[1])[0]!;
    expect(top[0]).toBe(immu);
  });

  it("classify matches only present tags and reports low confidence without matches", async () => {
    const d = createPolicyDecider({
      policy: initialSearchPolicy(),
      knownTags: ["signaling", "hormesis"],
    });
    const res = await d.classifyStructure({
      problemText: "a signaling and matching problem",
      knownTags: ["signaling", "hormesis"],
    });
    expect(res.structureTags).toEqual(["signaling"]);
    const none = await d.classifyStructure({
      problemText: "zzz qqq vvv",
      knownTags: ["signaling"],
    });
    expect(none.structureTags).toEqual([]);
    expect(none.confidence).toBeLessThanOrEqual(0.1);
  });

  it("screen is conservative: keeps anything with lexical overlap", async () => {
    const d = createPolicyDecider({ policy: initialSearchPolicy() });
    const res = await d.screenCandidates(structure, [
      {
        candidateId: "a",
        title: "signal boost",
        proposal: "approach to the matching search problem of signaling",
      },
      { candidateId: "b", title: "qqq zzz", proposal: "vvv xxx yyy www" },
    ]);
    const a = res.verdicts.find((v) => v.candidateId === "a")!;
    const b = res.verdicts.find((v) => v.candidateId === "b")!;
    expect(a.keep).toBe(true);
    expect(b.keep).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Jev adapter — documented API fixtures (POST /v1/systemone)
// ---------------------------------------------------------------------------

function jevFixtureFetch(log: unknown[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    log.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: Object.fromEntries(
          Object.entries(
            (
              JSON.parse(String(init?.body)) as {
                questions: Record<string, unknown>;
              }
            ).questions,
          ).map(([qid, q], i) => {
            if ((q as { type: string }).type === "noul") {
              return [
                qid,
                {
                  type: "noul",
                  noul: qid.startsWith("tag_")
                    ? i % 2 === 0
                      ? 0.9
                      : 0.1
                    : 0.8,
                  confidence: 0.9,
                },
              ];
            }
            return [
              qid,
              {
                type: "score",
                score: 3,
                confidence: 0.9,
                probabilities: { "0": 0, "1": 0, "2": 0, "3": 1, "4": 0 },
              },
            ];
          }),
        ),
        usage: { input_tokens: 500, output_tokens: 20 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("jev decider (fixture-backed, no network)", () => {
  const policy = initialSearchPolicy();

  it("sends documented request shape and parses answers + usage", async () => {
    const log: unknown[] = [];
    const jev = createJevDecider({
      apiKey: "k-test",
      policy,
      fetchImpl: jevFixtureFetch(log) as never,
    });
    const res = await jev.rankHypotheses(structure, mech);
    const body = log[0] as {
      model: string;
      state: unknown;
      questions: Record<string, { type: string; criteria?: unknown }>;
    };
    expect(body.model).toBe("jev-latest");
    // one score question per mechanism
    expect(Object.values(body.questions).every((q) => q.type === "score")).toBe(
      true,
    );
    expect(Object.keys(body.questions)).toHaveLength(mech.length);
    // score-3/4 × high confidence boosts learned baseline within bounds
    expect(res.providerId).toBe("jev:jev-latest");
    expect(res.usage.inputTokens).toBe(500);
    expect(res.usage.costUsd).toBeCloseTo((500 / 1e6) * 0.042, 6);
  });

  it("modulates but never replaces the learned rank (bounded boost)", async () => {
    const learned: SearchPolicy = {
      ...policy,
      compatWeights: { ...policy.compatWeights, "tf:signaling|immunology": 4 },
    };
    const log: unknown[] = [];
    const jev = createJevDecider({
      apiKey: "k",
      policy: learned,
      fetchImpl: jevFixtureFetch(log) as never,
    });
    const res = await jev.rankHypotheses(structure, mech);
    // fixture gives every mechanism score 3 → same multiplier for all →
    // ORDER matches the learned order (policy stays authoritative)
    const learnedOrder = Object.entries(
      policyRankScores(structure, mech, learned),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const jevOrder = Object.entries(res.priorities)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    expect(jevOrder).toEqual(learnedOrder);
  });

  it("classifies via noul battery", async () => {
    const log: unknown[] = [];
    const jev = createJevDecider({
      apiKey: "k",
      policy,
      fetchImpl: jevFixtureFetch(log) as never,
    });
    const res = await jev.classifyStructure({
      problemText: "a problem",
      knownTags: ["signaling", "search", "trust"],
    });
    expect(res.providerId).toBe("jev:jev-latest");
    // fixture: even indices noul 0.9, odd 0.1 → first and third tags picked
    expect(res.structureTags).toEqual(["signaling", "trust"]);
    expect(res.structureTags.length).toBeGreaterThan(0);
  });

  it("missing answer → conservative keep / learned-only rank (no fabrication)", async () => {
    const fetchMissing: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {},
          usage: { input_tokens: 10 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as never;
    const jev = createJevDecider({
      apiKey: "k",
      policy,
      fetchImpl: fetchMissing,
    });
    const rank = await jev.rankHypotheses(structure, mech);
    expect(rank.priorities).toEqual(policyRankScores(structure, mech, policy));
    const screen = await jev.screenCandidates(structure, [
      { candidateId: "x", title: "t", proposal: "p" },
    ]);
    expect(screen.verdicts[0]!.keep).toBe(true);
  });

  it("throws without apiKey", () => {
    expect(() => createJevDecider({ apiKey: "", policy })).toThrow();
  });
});

describe("resolver + fallback chain", () => {
  it("resolves to policy decider without JEV_API_KEY", () => {
    const r = resolveDecisionProvider({ policy: initialSearchPolicy() });
    expect(r.resolution).toBe("policy");
    expect(r.usingExternalDecider).toBe(false);
  });

  it("resolves to jev with JEV_API_KEY", () => {
    const r = resolveDecisionProvider({
      policy: initialSearchPolicy(),
      env: { JEV_API_KEY: "k" },
      fetchImpl: jevFixtureFetch([]) as never,
    });
    expect(r.resolution).toBe("jev");
    expect(r.providerId).toBe("jev:jev-latest");
  });

  it("falls back per-call when jev fails mid-run and records the failure", async () => {
    const policy = initialSearchPolicy();
    const failing: typeof import("./types").DecisionProvider = {
      providerId: "failing",
      classifyStructure: async () => {
        throw new Error("jev down");
      },
      rankHypotheses: async () => {
        throw new Error("jev down");
      },
      screenCandidates: async () => {
        throw new Error("jev down");
      },
    };
    const wrapped = withFallback(failing, createPolicyDecider({ policy }));
    const rank = await wrapped.rankHypotheses(structure, mech);
    expect(rank.providerId).toBe("policy-algorithmic-v1");
    expect(wrapped.failures).toHaveLength(1);
    // screen still functions (fallback answered)
    const screen = await wrapped.screenCandidates(structure, [
      { candidateId: "a", title: "signal", proposal: "matching approach" },
    ]);
    expect(screen.verdicts[0]!.keep).toBe(true);
    expect(wrapped.failures).toHaveLength(2);
  });
});

describe("engine integration — decision tier inside runExperiment", () => {
  it("records decision provider + usage in modelInfo; screening bounded by 30%", async () => {
    const model = createFakeModel();
    const policy = initialSearchPolicy();
    // a decision provider that wants to drop EVERYTHING
    const hostile = {
      providerId: "hostile-screener",
      classifyStructure: async () => ({
        structureTags: [],
        confidence: 0,
        providerId: "hostile",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          modelCalls: 1,
          wallClockMs: 0,
        },
      }),
      rankHypotheses: async () => ({
        priorities: {},
        providerId: "hostile",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          modelCalls: 0,
          wallClockMs: 0,
        },
      }),
      screenCandidates: async (
        _s: unknown,
        cands: Array<{ candidateId: string }>,
      ) => ({
        verdicts: cands.map((c) => ({
          candidateId: c.candidateId,
          keep: false,
          confidence: 0.99,
          reason: "hostile",
        })),
        providerId: "hostile",
        usage: {
          inputTokens: 10,
          outputTokens: 0,
          costUsd: 0.000001,
          modelCalls: 1,
          wallClockMs: 5,
        },
      }),
    };
    const { record } = await runExperiment(model, {
      experimentId: "exp_dec_1",
      workspaceId: "ws",
      problemId: "p",
      problemText:
        "I need an unconventional job search approach after hundreds of applications failed.",
      domain: "personal",
      budgetPreset: "standard",
      map: initialConceptualMap(),
      policy,
      seed: 7,
      decisionProvider: hostile as never,
    });
    expect(record.modelInfo.decisionProvider).toBe("hostile-screener");
    // bounded: even a hostile screener cannot drop everything
    const active = record.candidates.filter(
      (c) => c.stage !== "discarded",
    ).length;
    const screened = record.candidates.filter((c) =>
      c.discardReason?.startsWith("decision screen"),
    ).length;
    expect(active).toBeGreaterThan(0);
    if (screened > 0) {
      expect(screened).toBeLessThanOrEqual(
        Math.ceil(record.candidates.length * 0.3),
      );
    }
    expect(record.errors.some((e) => e.includes("decision"))).toBe(false);
  });

  it("default resolution (no JEV key) uses the policy decider with zero decision cost", async () => {
    const model = createFakeModel();
    const { record } = await runExperiment(model, {
      experimentId: "exp_dec_2",
      workspaceId: "ws",
      problemId: "p",
      problemText: "Unconventional approach to reduce customer churn.",
      domain: "business",
      budgetPreset: "quick",
      map: initialConceptualMap(),
      policy: initialSearchPolicy(),
      seed: 3,
    });
    expect(record.modelInfo.decisionProvider).toBe("policy-algorithmic-v1");
    expect(record.modelInfo.decisionCostUsd).toBe("0.000000");
  });
});
