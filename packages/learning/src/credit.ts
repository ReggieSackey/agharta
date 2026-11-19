/**
 * Credit assignment: map idea-level events to operator counters.
 * Bias safeguard: every assignment records exposure context (domain + attempt
 * number), so naive success counts can be compared within matched domains.
 */
import type { FeedbackAction, OperatorId } from '@agharta/shared';
import type { OperatorCounters } from './stats';

export type EvidenceClass = 'proxy' | 'outcome' | 'exposure';

export interface CreditEvent {
  operatorId: OperatorId;
  domain: string;
  /** what happened */
  kind:
    | 'generated'
    | 'valid'
    | 'unique'
    | 'provisionally_qualified'
    | 'feedback';
  action?: FeedbackAction;
}

export function applyCredit(counters: OperatorCounters, ev: CreditEvent): OperatorCounters {
  const c = { ...counters };
  switch (ev.kind) {
    case 'generated': c.generated += 1; break;
    case 'valid': c.valid += 1; break;
    case 'unique': c.unique += 1; break;
    case 'provisionally_qualified': c.provisionallyQualified += 1; break;
    case 'feedback':
      switch (ev.action) {
        case 'shortlisted': c.shortlisted += 1; break;
        case 'attempted': c.attempted += 1; break;
        case 'succeeded': c.succeeded += 1; break;
        case 'failed': c.failed += 1; break;
        case 'rejected': /* recorded but not a failure signal */ break;
      }
      // unknown = generated-without-decided-outcome is derived, not incremented here
      break;
  }
  return c;
}

/** Derived unknown count: attempted-or-shortlisted ideas without terminal outcome. */
export function unknownOutcomeCount(c: OperatorCounters): number {
  return Math.max(0, c.shortlisted + c.attempted - c.succeeded - c.failed - c.attempted);
}

/**
 * Naive-vs-matched comparison for the bias safeguard display: compares raw
 * success counts with per-domain rates so exposure imbalance is visible.
 */
export function biasDiagnostic(stats: {
  byOperator: Record<OperatorId, OperatorCounters>;
  byOperatorDomain: Array<{ operatorId: OperatorId; domain: string; succeeded: number; attempted: number }>;
}): Array<{ operatorId: OperatorId; naiveRate: number; matchedRate: number | null; note: string }> {
  const out = [];
  for (const [op, c] of Object.entries(stats.byOperator) as Array<[OperatorId, OperatorCounters]>) {
    const rows = stats.byOperatorDomain.filter((r) => r.operatorId === op && r.attempted > 0);
    const naive = c.attempted > 0 ? c.succeeded / c.attempted : 0;
    const matched = rows.length
      ? rows.reduce((s, r) => s + (r.succeeded / r.attempted), 0) / rows.length
      : null;
    out.push({
      operatorId: op,
      naiveRate: round4(naive),
      matchedRate: matched === null ? null : round4(matched),
      note: rows.length < 2 ? 'few matched domains; treat with caution' : 'domain-matched average',
    });
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
