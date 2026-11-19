/**
 * Deterministic evaluation checks (evidence tier A).
 */
import type { Idea, Usage } from '@agharta/shared';
import { IdeaSchema } from '@agharta/shared';

export interface DeterministicCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export function checkSchema(idea: Idea): DeterministicCheck {
  const r = IdeaSchema.safeParse(idea);
  return { name: 'schema', passed: r.success, detail: r.success ? undefined : JSON.stringify(r.error.issues.slice(0, 3)) };
}

export function checkLineage(idea: Idea, knownIds: Set<string>): DeterministicCheck {
  const bad = idea.parentIds.filter((p) => !knownIds.has(p));
  return { name: 'lineage', passed: bad.length === 0, detail: bad.length ? `unknown parents: ${bad.join(',')}` : undefined };
}

export function checkBudget(usage: Usage, maxCostUsd: number): DeterministicCheck {
  return { name: 'budget', passed: usage.costUsd <= maxCostUsd, detail: `cost $${usage.costUsd.toFixed(4)} / cap $${maxCostUsd}` };
}

export function checkHardConstraint(text: string, constraint: string): DeterministicCheck {
  // deterministic only for simple presence constraints; judge handles nuance
  const violated = constraint.includes('must not') && text.toLowerCase().includes(constraint.replace(/^.*must not/i, 'must not').toLowerCase());
  return { name: 'hard_constraint', passed: !violated, detail: constraint };
}

export function runDeterministicChecks(idea: Idea, knownIds: Set<string>, usage: Usage, maxCostUsd: number): DeterministicCheck[] {
  return [checkSchema(idea), checkLineage(idea, knownIds), checkBudget(usage, maxCostUsd)];
}
