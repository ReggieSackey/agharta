export {
  emptyCounters,
  emptyStatsMap,
  smoothQualification,
  smoothOutcome,
  thompsonWeights,
  sampleBeta,
  wilsonHalfWidth,
  PRIOR_ALPHA,
  PRIOR_BETA,
} from './stats';
export type { OperatorCounters, OperatorStatsMap, SmoothedEstimate } from './stats';
export {
  decideAllocation,
  DEFAULT_EXPLORATION_FLOOR,
} from './allocation';
export type { AllocationDecision } from './allocation';
export { applyCredit, unknownOutcomeCount, biasDiagnostic } from './credit';
export type { CreditEvent, EvidenceClass } from './credit';
export {
  OptimizerOutputSchema,
  buildChallenger,
  evaluateGate,
  DEFAULT_PROMOTION_GATE,
  fallbackProposal,
} from './challenger';
export type { OptimizerOutput, ArmResult, ExperimentRecord, PromotionGate, GateEvaluation } from './challenger';
export { promoteStrategy } from './promotion';
export type { PromotionOutcome, PromotionAuditEntry } from './promotion';

// V2 learning engine
export * from './v2/compat';
export * from './v2/selection';
export * from './v2/learn';
export { extractObservation } from './v2/observe';
export * from './v2/initial';
export * from './v2/gate';
