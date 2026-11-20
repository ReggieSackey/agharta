/**
 * Decision-provider resolution with a tested fallback chain.
 *
 * Order: BYOK/env-configured Jev → policy algorithmic (always works, zero
 * cost). A Jev failure mid-run (timeout, HTTP error, malformed answer) falls
 * back per-call to the policy decider; the failure is surfaced so cost/health
 * accounting stays honest. The exploration floor and slot structure are
 * decided by the LEARNED policy alone — no decision provider can touch them.
 */
import type { ConceptualMap, SearchPolicy } from "@agharta/shared";
import { createPolicyDecider } from "./policyDecider";
import { createJevDecider } from "./jevDecider";
import type { DecisionProvider } from "./types";

export * from "./types";
export {
  createPolicyDecider,
  policyRankScores,
  mapEdgeMean,
} from "./policyDecider";
export { createJevDecider } from "./jevDecider";

export interface DecisionEnv {
  JEV_API_KEY?: string;
  JEV_MODEL?: string;
}

export interface ResolveDeciderOptions {
  policy: SearchPolicy;
  map?: ConceptualMap;
  env?: DecisionEnv;
  /** inject for tests */
  fetchImpl?: typeof fetch;
}

export interface ResolvedDecider {
  provider: DecisionProvider;
  providerId: string;
  /** true when Jev (or another non-algorithmic decider) is active */
  usingExternalDecider: boolean;
  /** how the decision tier was chosen — recorded in experiment modelInfo */
  resolution: "jev" | "policy";
}

export function resolveDecisionProvider(
  opts: ResolveDeciderOptions,
): ResolvedDecider {
  const policy = createPolicyDecider({ policy: opts.policy, map: opts.map });
  const env = opts.env ?? {};
  if (env.JEV_API_KEY) {
    try {
      const jev = createJevDecider({
        apiKey: env.JEV_API_KEY,
        model: env.JEV_MODEL,
        policy: opts.policy,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      return {
        provider: jev,
        providerId: jev.providerId,
        usingExternalDecider: true,
        resolution: "jev",
      };
    } catch {
      // fall through to policy decider
    }
  }
  return {
    provider: policy,
    providerId: policy.providerId,
    usingExternalDecider: false,
    resolution: "policy",
  };
}

/**
 * Wrap any provider with per-call fallback: on error, delegate to the policy
 * decider and record the failure. Guarantees "system remains functional
 * without Jev" even mid-run.
 */
export function withFallback(
  primary: DecisionProvider,
  fallback: DecisionProvider,
): DecisionProvider & {
  failures: Array<{ method: string; error: string; at: number }>;
} {
  const failures: Array<{ method: string; error: string; at: number }> = [];
  const guard = async <T>(
    method: "classifyStructure" | "rankHypotheses" | "screenCandidates",
    args: unknown[],
    fn: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      failures.push({
        method,
        error: String(err).slice(0, 300),
        at: Date.now(),
      });
      const fb = fallback[method] as (...a: unknown[]) => Promise<T>;
      return await fb(...args);
    }
  };
  return {
    providerId: primary.providerId,
    classifyStructure: (input) =>
      guard("classifyStructure", [input], () =>
        primary.classifyStructure(input),
      ),
    rankHypotheses: (structure, mechanisms) =>
      guard("rankHypotheses", [structure, mechanisms], () =>
        primary.rankHypotheses(structure, mechanisms),
      ),
    screenCandidates: (structure, candidates) =>
      guard("screenCandidates", [structure, candidates], () =>
        primary.screenCandidates(structure, candidates),
      ),
    failures,
  };
}
