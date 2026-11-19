/**
 * Promotion: apply an eligible experiment with explicit user confirmation.
 * A rejected strategy can NEVER become active. All transitions are logged.
 */
import type { OperatorId, SearchStrategy } from '@agharta/shared';

export interface PromotionAuditEntry {
  experimentId: string;
  fromVersion: string;
  toVersion: string;
  decision: 'promoted' | 'rejected';
  by: string; // user identity
  at: number;
  rationale: string;
}

export interface PromotionOutcome {
  ok: boolean;
  error?: string;
  newChampion?: SearchStrategy;
  audit: PromotionAuditEntry;
}

export function promoteStrategy(
  experiment: {
    id: string;
    decision: 'pending_user_promotion' | 'eligible_for_promotion' | 'rejected';
    challengerStrategyId: string;
    rationale: string;
  },
  challenger: SearchStrategy,
  actor: string,
  gateEligible: boolean
): PromotionOutcome {
  const audit: PromotionAuditEntry = {
    experimentId: experiment.id,
    fromVersion: 'champion',
    toVersion: challenger.version,
    decision: 'promoted',
    by: actor,
    at: Date.now(),
    rationale: experiment.rationale,
  };
  if (experiment.decision === 'rejected') {
    return { ok: false, error: 'rejected experiment cannot be promoted', audit: { ...audit, decision: 'rejected' } };
  }
  if (!gateEligible) {
    return { ok: false, error: 'promotion gate not satisfied', audit: { ...audit, decision: 'rejected' } };
  }
  const newChampion: SearchStrategy = structuredClone(challenger);
  newChampion.isChampion = true;
  // strip -challenger suffix for the promoted version label
  newChampion.version = challenger.version.replace(/-challenger$/, '');
  return { ok: true, newChampion, audit };
}
