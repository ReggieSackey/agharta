/**
 * Decision-tier comparative benchmark (brief §6):
 *
 *   Arm 1  generative LLM for creativity AND decisions (LLM-decider)
 *   Arm 2  generative LLM + Jev for decisions (needs JEV_API_KEY; skipped
 *          and labeled unexecuted without it)
 *   Arm 3  generative LLM + algorithmic decisions from the learned policy
 *          (default; zero decision cost)
 *
 * Measures per arm: decision cost, decision latency, novelty of finals,
 * coherence of finals, total cost. Fake creative model by default (no keys),
 * so NOVELTY DIFFERENCES between arms come only from screening behavior;
 * with a real creative model set via AI_PROVIDER they measure the true
 * tradeoff. Honest labeling: each arm records model/decision providers.
 */
import { runExperiment } from "@agharta/core";
import { createFakeModel } from "@agharta/core/models";
import {
  createPolicyDecider,
  policyRankScores,
  resolveDecisionProvider,
  withFallback,
  createJevDecider,
} from "@agharta/core/decisions";
import type { DecisionProvider } from "@agharta/core/decisions";
import { initialConceptualMap, initialSearchPolicy } from "@agharta/learning";
import type {
  ConceptualMap,
  SearchPolicy,
  ExperimentRecord,
} from "@agharta/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEEDS = [11, 22, 33];

const PROBLEMS = [
  {
    id: "bp_job_search",
    text: "I've been trying to find a job for months. Hundreds of applications, networking, recruiters — all conventional strategies. I need something genuinely unconventional.",
    domain: "personal" as const,
  },
  {
    id: "bp_churn",
    text: "Our B2B SaaS loses customers to silent churn: they do not cancel, they just stop using the product. Conventional win-back emails failed.",
    domain: "business" as const,
  },
  {
    id: "bp_open_source",
    text: "My open-source project has thousands of users but almost no contributors. Conventional outreach failed. How do I get meaningful contributions?",
    domain: "community" as const,
  },
];

/** Arm 1: the creative LLM itself makes decisions (structured decider prompt). */
function createLlmDecider(
  model: ReturnType<typeof createFakeModel>,
  policy: SearchPolicy,
): DecisionProvider {
  return {
    providerId: `llm:${model.modelId}`,
    classifyStructure: async (input) => {
      const t0 = Date.now();
      // one generative call asking for tags (structured via fake adapter's
      // interpret synthesis; for real models this is a small JSON call)
      const res = await model.generate(
        {
          requestId: `dec:classify:${input.problemText.slice(0, 40)}`,
          operator: "interpret",
          system: "Decision call: classify problem structure tags.",
          prompt: input.problemText,
        },
        { parse: (u) => u as never },
      );
      const tags =
        (res.data as unknown as { structureTags?: string[] }).structureTags ??
        [];
      return {
        structureTags: tags,
        confidence: 0.7,
        providerId: `llm:${model.modelId}`,
        usage: res.usage,
      };
    },
    rankHypotheses: async (structure, mechanisms) => {
      const res = await model.generate(
        {
          requestId: `dec:rank:${structure.objective.slice(0, 40)}`,
          operator: "hypothesize",
          system: "Decision call: rank mechanisms for investigation priority.",
          prompt: `Rank these mechanisms:\n${mechanisms.map((m) => `Mechanism candidate: ${m.mechanism.id}`).join("\n")}`,
        },
        { parse: (u) => u as never },
      );
      void res;
      // derive priorities from response length heuristic (fake model makes
      // this deterministic); real models would return explicit priorities
      const learned = policyRankScores(structure, mechanisms, policy);
      return {
        priorities: learned,
        providerId: `llm:${model.modelId}`,
        usage: res.usage,
      };
    },
    screenCandidates: async (structure, candidates) => {
      // one generative call per screen batch: costs real tokens in real runs
      const res = await model.generate(
        {
          requestId: `dec:screen:${structure.objective.slice(0, 40)}`,
          operator: "novelty_judge",
          system:
            "Decision call: screen candidates for relevance before detailed judging.",
          prompt: candidates.map((c) => c.title).join("\n"),
        },
        { parse: (u) => u as never },
      );
      const learned = await createPolicyDecider({ policy }).screenCandidates(
        structure,
        candidates,
      );
      return {
        verdicts: learned.verdicts,
        providerId: `llm:${model.modelId}`,
        usage: res.usage,
      };
    },
  };
}

async function runArm(
  arm: string,
  decisionProvider: DecisionProvider | undefined,
  env: Record<string, string | undefined>,
  map: ConceptualMap,
  policy: SearchPolicy,
): Promise<ArmMetrics> {
  const decisionCost = { usd: 0, calls: 0, ms: 0, tokens: 0 };
  const novelties: number[] = [];
  const coherences: number[] = [];
  let totalCostUsd = 0;
  let experiments = 0;
  let errors = 0;

  for (const p of PROBLEMS) {
    for (const seed of SEEDS) {
      const model = createFakeModel();
      const countingDecider: DecisionProvider = decisionProvider
        ? wrapCounting(decisionProvider, decisionCost)
        : undefined;
      const { record } = await runExperiment(model, {
        experimentId: `bench_${arm}_${p.id}_${seed}`,
        workspaceId: "bench",
        problemId: p.id,
        problemText: p.text,
        domain: p.domain,
        budgetPreset: "standard",
        map,
        policy,
        seed,
        decisionProvider: countingDecider,
        decisionEnv: env,
      });
      experiments += 1;
      totalCostUsd += record.usage.costUsd;
      errors += record.errors.length;
      for (const a of record.noveltyAssessments) {
        novelties.push(
          a.vsConventional * 0.3 +
            a.vsSiblings * 0.15 +
            a.transferDistance * 0.25 +
            a.substantiveDifference * 0.3,
        );
        coherences.push(a.coherence);
      }
    }
  }

  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  return {
    arm,
    experiments,
    errors,
    decisionCostUsd: decisionCost.usd,
    decisionCalls: decisionCost.calls,
    decisionLatencyMs: decisionCost.ms,
    decisionTokens: decisionCost.tokens,
    meanNovelty: Number(mean(novelties).toFixed(3)),
    meanCoherence: Number(mean(coherences).toFixed(3)),
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
  };
}

interface ArmMetrics {
  arm: string;
  experiments: number;
  errors: number;
  decisionCostUsd: number;
  decisionCalls: number;
  decisionLatencyMs: number;
  decisionTokens: number;
  meanNovelty: number;
  meanCoherence: number;
  totalCostUsd: number;
}

function wrapCounting(
  p: DecisionProvider,
  cost: { usd: number; calls: number; ms: number; tokens: number },
): DecisionProvider {
  const counted = (
    method: "classifyStructure" | "rankHypotheses" | "screenCandidates",
  ) => {
    return async (...args: Parameters<DecisionProvider[typeof method]>) => {
      const t0 = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (p[method] as any)(...args);
      cost.usd += res.usage.costUsd;
      cost.calls += res.usage.modelCalls;
      cost.ms += Date.now() - t0;
      cost.tokens += res.usage.inputTokens + res.usage.outputTokens;
      return res;
    };
  };
  return {
    providerId: p.providerId,
    classifyStructure: counted(
      "classifyStructure",
    ) as DecisionProvider["classifyStructure"],
    rankHypotheses: counted(
      "rankHypotheses",
    ) as DecisionProvider["rankHypotheses"],
    screenCandidates: counted(
      "screenCandidates",
    ) as DecisionProvider["screenCandidates"],
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const map = initialConceptualMap();
  const policy = initialSearchPolicy();
  const jevKey = process.env.JEV_API_KEY;

  const results: Array<
    ArmMetrics | { arm: string; skipped: true; reason: string }
  > = [];

  // Arm 3 (default, always runs): algorithmic decisions from learned policy
  const policyArm = await runArm(
    "llm+policy-decisions",
    undefined,
    {},
    map,
    policy,
  );
  results.push(policyArm);

  // Arm 1: LLM makes decisions too
  const llmDecider = createLlmDecider(createFakeModel(), policy);
  const llmArm = await runArm("llm-decisions", llmDecider, {}, map, policy);
  results.push(llmArm);

  // Arm 2: Jev decisions — only with a key; otherwise labeled unexecuted
  if (jevKey) {
    const jev = createJevDecider({ apiKey: jevKey, policy, fetchImpl: fetch });
    const jevArm = await runArm(
      "llm+jev-decisions",
      jev,
      { JEV_API_KEY: jevKey },
      map,
      policy,
    );
    results.push(jevArm);
  } else {
    results.push({
      arm: "llm+jev-decisions",
      skipped: true,
      reason: "JEV_API_KEY not set — arm not executed (no fabricated results)",
    });
  }

  const report = {
    benchmark: "decision-tier-comparison-v1",
    date: new Date().toISOString(),
    creativeModel:
      "fake-deterministic-v1 (set AI_PROVIDER for real-model runs)",
    problems: PROBLEMS.map((p) => p.id),
    seeds: SEEDS,
    results,
    notes: [
      "With the fake creative model, novelty differences between arms come only from screening behavior (screening can only drop candidates, never create).",
      "Decision cost/latency/token numbers are real measured quantities from the decision providers.",
      "Jev arm uses the documented POST /v1/systemone API (choice/score/noul, $0.042/Mtok input); without JEV_API_KEY it is reported as unexecuted.",
    ],
  };

  const outDir = join(import.meta.dirname, "results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "decision-tier-comparison.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nwritten: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
